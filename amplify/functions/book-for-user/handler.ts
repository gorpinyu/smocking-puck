import { randomUUID } from 'crypto';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';

const cognito = new CognitoIdentityProviderClient();
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient());

// Booking/BookingHistory use owner-based auth keyed off the `cognito:username`
// claim (confirmed against the deployed pool: a plain-email user's owner is
// their Cognito Username/sub, a Google user's is `google_<id>`) - so writing
// a record "as" the guardian just means putting that exact string in `owner`,
// found by looking their email up in the User Pool directly rather than
// going through the normal create-as-yourself AppSync resolver.
async function findOwnerByEmail(email: string): Promise<string | undefined> {
  const { Users } = await cognito.send(new ListUsersCommand({
    UserPoolId: process.env.AMPLIFY_AUTH_USERPOOL_ID,
    Filter: `email = "${email.replace(/"/g, '')}"`,
    Limit: 1,
  }));
  return Users?.[0]?.Username;
}

export const handler: Schema['bookForUser']['functionHandler'] = async (event) => {
  const {
    sessionId, sessionDate, sessionTime, sessionTitle,
    guardianEmail, guardianName, mode, playerName, playerName2,
  } = event.arguments;

  const guardianOwner = await findOwnerByEmail(guardianEmail);
  // No account for that email yet (e.g. a phone booking for someone who's
  // never signed up on the site) - fall back to the admin's own identity
  // rather than blocking the booking, same as the old behavior. The caller
  // (an Admins-group member) is the one invoking this mutation, so their
  // claims are on the Lambda resolver's identity context.
  const adminOwner = event.identity && 'claims' in event.identity
    ? (event.identity.claims?.['cognito:username'] as string | undefined)
    : undefined;
  const owner = guardianOwner ?? adminOwner;
  const attributedToGuardian = Boolean(guardianOwner);

  const now = new Date().toISOString();
  const bookingId = randomUUID();

  await ddb.send(new PutCommand({
    TableName: process.env.BOOKING_TABLE_NAME,
    Item: {
      id: bookingId,
      sessionId,
      sessionDate,
      userName: guardianName,
      userEmail: guardianEmail,
      mode,
      playerName,
      ...(playerName2 ? { playerName2 } : {}),
      owner,
      createdAt: now,
      updatedAt: now,
      __typename: 'Booking',
    },
  }));

  await ddb.send(new PutCommand({
    TableName: process.env.HISTORY_TABLE_NAME,
    Item: {
      id: randomUUID(),
      action: 'BOOKED',
      sessionId,
      sessionDate,
      sessionTime,
      sessionTitle,
      userName: guardianName,
      userEmail: guardianEmail,
      mode,
      playerName,
      ...(playerName2 ? { playerName2 } : {}),
      owner,
      createdAt: now,
      updatedAt: now,
      __typename: 'BookingHistory',
    },
  }));

  return {
    id: bookingId,
    userName: guardianName,
    userEmail: guardianEmail,
    mode,
    playerName,
    playerName2: playerName2 ?? null,
    attributedToGuardian,
  };
};
