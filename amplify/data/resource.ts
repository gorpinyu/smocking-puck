import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  Session: a
    .model({
      title: a.string().required(),
      date: a.string().required(), // 'YYYY-MM-DD'
      time: a.string().required(), // 'HH:MM'
      duration: a.integer().required(),
      maxCapacity: a.integer().required(),
      // Maintained client-side (create/cancel booking also updates this) so
      // any signed-in user can read "spots left" without needing access to
      // every other user's individual Booking records.
      bookedCount: a
        .integer()
        .required()
        .default(0)
        .authorization((allow) => [allow.authenticated().to(['read', 'update'])]),
    })
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.group('Admins'),
    ]),

  Booking: a
    .model({
      sessionId: a.id().required(),
      sessionDate: a.string().required(), // denormalized for filtering past bookings
      userName: a.string().required(), // denormalized at booking time for the admin "Who" list
      userEmail: a.string().required(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group('Admins').to(['read', 'delete']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
