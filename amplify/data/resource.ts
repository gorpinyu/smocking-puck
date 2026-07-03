import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  Session: a
    .model({
      title: a.string().required(),
      date: a.string().required(), // 'YYYY-MM-DD'
      time: a.string().required(), // 'HH:MM'
      duration: a.integer().required(),
      // A session is a single coach time-slot: one booking (1-on-1 or 1-on-2,
      // the booker's choice) takes the whole thing. Maintained client-side
      // (create/cancel booking also updates this) so any signed-in user can
      // read status without needing access to every other user's Booking.
      booked: a
        .boolean()
        .required()
        .default(false)
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
      // Picked by the booker, not the admin - a session has no fixed format.
      mode: a.enum(['ONE_ON_ONE', 'ONE_ON_TWO']),
      playerName: a.string().required(),
      // Optional even on a 1-on-2 booking - the format is the booker's
      // choice regardless of whether a second player is actually named.
      playerName2: a.string(),
    })
    .authorization((allow) => [
      allow.owner(),
      // 'create' lets the admin dashboard book an open session on behalf of
      // a guardian who can't/didn't book it themselves.
      allow.group('Admins').to(['read', 'create', 'delete']),
    ]),

  Player: a
    .model({
      name: a.string().required(),
    })
    .authorization((allow) => [allow.owner()]),

  // Append-only audit trail of booking activity. Kept separate from Booking
  // itself (rather than e.g. a soft-delete flag on Booking) because a
  // cancelled Booking record is actually deleted - the log is what survives
  // that delete so "what happened" isn't lost along with the booking.
  // createdAt (auto-added by every Amplify Data model) is the event timestamp.
  BookingHistory: a
    .model({
      action: a.enum(['BOOKED', 'CANCELLED']),
      sessionId: a.id().required(),
      sessionDate: a.string().required(), // 'YYYY-MM-DD', denormalized - the Session itself may later be deleted
      sessionTime: a.string().required(), // 'HH:MM'
      sessionTitle: a.string().required(),
      userName: a.string().required(),
      userEmail: a.string().required(),
      mode: a.enum(['ONE_ON_ONE', 'ONE_ON_TWO']),
      playerName: a.string(),
      playerName2: a.string(),
    })
    .authorization((allow) => [
      // Owner can create (their own action) and read their own history, but
      // never edit/delete it - it's a record of what happened, not a
      // reflection of current state.
      allow.owner().to(['create', 'read']),
      // Same trade-off as Booking's admin-create: an admin-driven action
      // (Book for User / Cancel Booking on the admin dashboard) logs an entry
      // owned by the admin's own identity, not the guardian's, so it shows in
      // the global Admin log but not on that guardian's own history.
      allow.group('Admins').to(['create', 'read']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});

