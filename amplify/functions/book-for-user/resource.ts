import { defineFunction } from '@aws-amplify/backend';

// Backs the admin "Book for User" mutation - looks up the guardian's real
// Cognito identity by email so the Booking/BookingHistory it writes can be
// owned by the guardian instead of the admin (see handler.ts).
//
// resourceGroupName: 'data' - without this, the function gets its own nested
// stack, and being both a data mutation handler (data->function) and a
// grantee of the Booking/BookingHistory tables (function->data, from the
// grantReadWriteData calls in backend.ts) is a 2-node cycle all on its own.
// Grouping the function into 'data' makes both of those internal to the
// same stack. The Cognito listUsers permission is deliberately NOT granted
// via auth/resource.ts's `access` config - that attaches its policy from
// auth's side, i.e. auth->data (since the function's role now lives in
// data), which fights data's own inherent data->auth reference (AppSync's
// userPool auth mode needs the User Pool) and reintroduces the exact same
// cycle. Instead, backend.ts attaches that policy directly to the
// function's (data-stack) role, referencing the User Pool by ARN - a
// data->auth reference, same direction as the inherent one, so it doesn't
// cycle.
export const bookForUserFn = defineFunction({
  name: 'book-for-user',
  entry: './handler.ts',
  resourceGroupName: 'data',
});
