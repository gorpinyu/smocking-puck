import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient();
const GROUP_NAME = 'Admins';

// This handler backs two schema operations (see resource.ts's comment for
// why one function). AppSync's Lambda-resolver event shape isn't imported
// from Amplify's generated Schema type here (that would mean typing this
// as a union of two incompatible functionHandler signatures, which forces
// awkward casts for no real safety gain) - instead it's hand-typed with
// just the fields actually used: `arguments` for setAdminRole's input (and
// to dispatch - see the handler below) and `identity` for the self-revoke
// check. An earlier version dispatched on `event.info.fieldName`, assuming
// the raw AppSync resolver ctx.info shape carried through to the Lambda
// event - confirmed wrong live (`event.info` was undefined at runtime;
// Amplify's generated Invoke payload doesn't nest fieldName under `info`).
// Rather than guess again at its actual undocumented location, dispatch on
// the one thing we know for certain: only setAdminRole's arguments ever
// include `username`.
interface ManageUsersEvent {
  arguments: { username?: string; makeAdmin?: boolean };
  identity?: { claims?: Record<string, unknown> } | null;
}

function getAttr(user: UserType, name: string): string | undefined {
  return user.Attributes?.find((a) => a.Name === name)?.Value;
}

async function listAllUsers(): Promise<UserType[]> {
  const users: UserType[] = [];
  let paginationToken: string | undefined;
  do {
    const { Users, PaginationToken } = await cognito.send(new ListUsersCommand({
      UserPoolId: process.env.AMPLIFY_AUTH_USERPOOL_ID,
      PaginationToken: paginationToken,
    }));
    users.push(...(Users || []));
    paginationToken = PaginationToken;
  } while (paginationToken);
  return users;
}

// A second paginated call rather than one ListUsers + N AdminListGroupsForUser
// calls (N+1) - cheap either way at this app's scale, but this stays cheap
// even if the user directory grows.
async function listAdminUsernames(): Promise<Set<string>> {
  const usernames = new Set<string>();
  let paginationToken: string | undefined;
  do {
    const { Users, NextToken } = await cognito.send(new ListUsersInGroupCommand({
      UserPoolId: process.env.AMPLIFY_AUTH_USERPOOL_ID,
      GroupName: GROUP_NAME,
      NextToken: paginationToken,
    }));
    (Users || []).forEach((u) => { if (u.Username) usernames.add(u.Username); });
    paginationToken = NextToken;
  } while (paginationToken);
  return usernames;
}

async function handleListAppUsers() {
  const [users, adminUsernames] = await Promise.all([listAllUsers(), listAdminUsernames()]);

  return users.filter((u) => u.Username).map((u) => {
    const email = getAttr(u, 'email') || '';
    const name = getAttr(u, 'name');
    return {
      username: u.Username as string,
      email,
      // Same fallback as app.js's getCurrentUser() (name || email) - a
      // Google sign-in maps a real name, but a plain-email account may
      // never have set one.
      name: name || email,
      isAdmin: adminUsernames.has(u.Username as string),
    };
  });
}

async function handleSetAdminRole(event: ManageUsersEvent) {
  const { username, makeAdmin } = event.arguments;
  if (!username) throw new Error('username is required.');

  // Read the caller's own identity the same defensive way
  // book-for-user/handler.ts reads the admin-fallback identity - this is an
  // Admins-group member (enforced by this operation's schema authorization),
  // acting on their own account.
  const callerUsername = event.identity && 'claims' in event.identity
    ? (event.identity.claims?.['cognito:username'] as string | undefined)
    : undefined;

  // Safety net, not a hard permission boundary (an admin who really means to
  // remove their own last-admin access can still do it via the AWS Console) -
  // this only stops an accidental self-lockout from this UI.
  if (makeAdmin === false && username === callerUsername) {
    throw new Error('You cannot revoke your own admin access.');
  }

  const command = makeAdmin
    ? new AdminAddUserToGroupCommand({ UserPoolId: process.env.AMPLIFY_AUTH_USERPOOL_ID, Username: username, GroupName: GROUP_NAME })
    : new AdminRemoveUserFromGroupCommand({ UserPoolId: process.env.AMPLIFY_AUTH_USERPOOL_ID, Username: username, GroupName: GROUP_NAME });
  await cognito.send(command);

  return { username, isAdmin: Boolean(makeAdmin) };
}

export const handler = async (event: ManageUsersEvent) => {
  if ('username' in event.arguments) {
    return handleSetAdminRole(event);
  }
  return handleListAppUsers();
};
