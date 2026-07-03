import { defineFunction } from '@aws-amplify/backend';

// Backs the admin "Book for User" mutation - looks up the guardian's real
// Cognito identity by email so the Booking/BookingHistory it writes can be
// owned by the guardian instead of the admin (see handler.ts).
//
// resourceGroupName: 'auth' - without this, the function gets its own nested
// CloudFormation stack, and being referenced by both auth (the listUsers
// access grant) and data (as the mutation handler) creates a circular
// dependency between the auth/data/function stacks (deploy fails with
// CloudformationStackCircularDependencyError). Grouping it into 'data'
// instead of 'auth' was tried first and still cycled: data already has an
// inherent data->auth reference (AppSync's userPool auth mode needs the
// Cognito User Pool), so moving the function into data just turned the
// listUsers grant into a second, opposite-direction auth->data edge - same
// cycle. Grouping it into 'auth' instead puts both necessary edges (data's
// existing need for auth, and data->function for the mutation handler) in
// the same direction: data -> auth. auth needs nothing back from data.
export const bookForUserFn = defineFunction({
  name: 'book-for-user',
  entry: './handler.ts',
  resourceGroupName: 'auth',
});
