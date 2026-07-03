import { defineFunction } from '@aws-amplify/backend';

// Backs the admin "Book for User" mutation - looks up the guardian's real
// Cognito identity by email so the Booking/BookingHistory it writes can be
// owned by the guardian instead of the admin (see handler.ts).
//
// resourceGroupName: 'data' - without this, the function gets its own nested
// CloudFormation stack, and being referenced by both auth (the listUsers
// access grant) and data (as the mutation handler) creates a genuine
// circular dependency between the auth/data/function stacks (deploy fails
// with CloudformationStackCircularDependencyError). Grouping it into the
// data stack - it's primarily a data resolver - collapses the data<->function
// edge entirely, leaving only a one-directional auth->data reference.
export const bookForUserFn = defineFunction({
  name: 'book-for-user',
  entry: './handler.ts',
  resourceGroupName: 'data',
});
