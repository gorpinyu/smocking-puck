import { defineBackend } from '@aws-amplify/backend';
import type { Function as CdkFunction } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { bookForUserFn } from './functions/book-for-user/resource';
import { manageUsersFn } from './functions/manage-users/resource';

const backend = defineBackend({
  auth,
  data,
  bookForUserFn,
  manageUsersFn,
});

// defineFunction()'s resources.lambda is typed as the CDK IFunction
// interface, which doesn't expose addEnvironment()/addToRolePolicy() - it's
// really a concrete aws-cdk-lib Function underneath, so this cast is just
// recovering the type info Amplify's own typing narrows away.
const bookForUserLambda = backend.bookForUserFn.resources.lambda as CdkFunction;
const { tables } = backend.data.resources;

tables.Booking.grantReadWriteData(bookForUserLambda);
tables.BookingHistory.grantReadWriteData(bookForUserLambda);
bookForUserLambda.addEnvironment('BOOKING_TABLE_NAME', tables.Booking.tableName);
bookForUserLambda.addEnvironment('HISTORY_TABLE_NAME', tables.BookingHistory.tableName);
bookForUserLambda.addEnvironment('AMPLIFY_AUTH_USERPOOL_ID', backend.auth.resources.userPool.userPoolId);

// Granted here (attached to the function's own role, which lives in the
// data stack per resourceGroupName above) rather than via auth/resource.ts's
// `access` config - that mechanism attaches the policy from auth's side
// instead, creating an auth->data reference that fights data's inherent
// data->auth one (AppSync's userPool auth mode needs the User Pool) and
// causes a CloudformationStackCircularDependencyError. This direction
// (data's own role referencing auth's User Pool ARN) matches the inherent
// edge instead of opposing it.
bookForUserLambda.addToRolePolicy(new PolicyStatement({
  actions: ['cognito-idp:ListUsers'],
  resources: [backend.auth.resources.userPool.userPoolArn],
}));

// manage-users (Access Management's listAppUsers/setAdminRole) never touches
// a DynamoDB table, so unlike bookForUserLambda above it needs no
// grantReadWriteData/table env vars - just the User Pool ID and the Cognito
// Admin API permissions it calls directly, granted the same data-stack-role
// way as above for the same reason (avoids the auth->data edge that would
// cycle with data's inherent data->auth reference).
const manageUsersLambda = backend.manageUsersFn.resources.lambda as CdkFunction;
manageUsersLambda.addEnvironment('AMPLIFY_AUTH_USERPOOL_ID', backend.auth.resources.userPool.userPoolId);
manageUsersLambda.addToRolePolicy(new PolicyStatement({
  actions: [
    'cognito-idp:ListUsers',
    'cognito-idp:ListUsersInGroup',
    'cognito-idp:AdminAddUserToGroup',
    'cognito-idp:AdminRemoveUserFromGroup',
  ],
  resources: [backend.auth.resources.userPool.userPoolArn],
}));
