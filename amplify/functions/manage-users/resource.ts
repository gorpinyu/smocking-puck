import { defineFunction } from '@aws-amplify/backend';

// Backs Access Management's listAppUsers query and setAdminRole mutation -
// lists every Cognito user (with current Admins-group membership) and
// grants/revokes that membership. One function backs both operations
// (see handler.ts's fieldName dispatch) since they're tightly coupled and
// this avoids duplicating the IAM/env wiring below across two functions.
//
// resourceGroupName: 'data' - same reasoning as book-for-user: this function
// is a data-schema handler (data->function edge, registered in
// data/resource.ts same as bookForUser is), so co-locating it in the 'data'
// stack keeps that edge internal. Unlike book-for-user, it never touches a
// DynamoDB table (no grantReadWriteData in backend.ts), so there's no
// function->data edge here to cycle with - but the Cognito Admin permissions
// it needs are still granted directly on this function's (data-stack) role
// in backend.ts, not via auth/resource.ts's `access` config, for consistency
// with that proven pattern rather than re-deriving from scratch whether the
// simpler auth-side grant would actually be safe here too.
export const manageUsersFn = defineFunction({
  name: 'manage-users',
  entry: './handler.ts',
  resourceGroupName: 'data',
});
