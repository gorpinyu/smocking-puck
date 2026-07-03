import { defineFunction } from '@aws-amplify/backend';

// Backs the admin "Book for User" mutation - looks up the guardian's real
// Cognito identity by email so the Booking/BookingHistory it writes can be
// owned by the guardian instead of the admin (see handler.ts).
export const bookForUserFn = defineFunction({
  name: 'book-for-user',
  entry: './handler.ts',
});
