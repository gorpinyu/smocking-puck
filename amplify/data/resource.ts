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
        .authorization((allow) => [
          // Field-level rules fully replace (not merge with) the model-level
          // rules for this field, so Admins must be re-granted explicitly here.
          allow.guest().to(['read']),
          allow.authenticated().to(['read', 'update']),
          allow.group('Admins'),
        ]),
    })
    .authorization((allow) => [
      // Session browsing is public - only booking requires login, per the
      // "not logged in -> redirect to login.html" flow in sessions.js.
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
      allow.group('Admins'),
    ]),

  Booking: a
    .model({
      sessionId: a.id().required(),
      sessionDate: a.string().required(), // denormalized for filtering past bookings
      userName: a.string().required(), // denormalized at booking time for the admin "Who" list
      userEmail: a.string().required(),
      playerName: a.string().required(),
      // Optional second player on a 1-on-2 booking - when set, the booking
      // consumes 2 spots (the single source of truth for bookedCount math).
      playerName2: a.string(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group('Admins').to(['read', 'delete']),
    ]),

  Player: a
    .model({
      name: a.string().required(),
    })
    .authorization((allow) => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});

