import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { bookForUserFn } from '../functions/book-for-user/resource';
import { manageUsersFn } from '../functions/manage-users/resource';

// Shared across Booking/BookingHistory/bookForUser's arguments+return so
// there's one GraphQL enum type, not three independently-declared ones.
const bookingMode = a.enum(['ONE_ON_ONE', 'ONE_ON_TWO']);

const schema = a.schema({
  // Named as a schema-level type (not inline in .returns()) so listAppUsers
  // can return an array of it via a.ref('AppUser').array() below -
  // a.customType({...}).array() isn't a valid chain (confirmed against a
  // real `ampx sandbox` deploy attempt); array returns of a custom shape
  // need a named type referenced this way instead.
  AppUser: a.customType({
    username: a.string().required(),
    email: a.string().required(),
    name: a.string().required(),
    isAdmin: a.boolean().required(),
  }),

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
      mode: bookingMode,
      playerName: a.string().required(),
      // Optional even on a 1-on-2 booking - the format is the booker's
      // choice regardless of whether a second player is actually named.
      playerName2: a.string(),
    })
    .authorization((allow) => [
      allow.owner(),
      // No 'create' here: the admin dashboard's "Book for User" goes through
      // the bookForUser Lambda mutation below instead of a normal API create,
      // because a normal create can only ever be owned by the caller (the
      // admin) - the Lambda writes the record directly so it can be owned by
      // the guardian it's actually for. See bookForUser/handler.ts.
      allow.group('Admins').to(['read', 'delete']),
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
      mode: bookingMode,
      playerName: a.string(),
      playerName2: a.string(),
    })
    .authorization((allow) => [
      // Owner can create (their own action) and read their own history, but
      // never edit/delete it - it's a record of what happened, not a
      // reflection of current state.
      allow.owner().to(['create', 'read']),
      // A BOOKED entry from "Book for User" is written by the bookForUser
      // Lambda (owned by the guardian, see below), not through this rule.
      // This rule still covers the admin dashboard's "Cancel Booking" action,
      // which logs a CANCELLED entry through the normal API and is therefore
      // still owned by the admin, not the guardian - same known trade-off,
      // just not worth a second Lambda for the one remaining case.
      allow.group('Admins').to(['create', 'read']),
    ]),

  // Backs the admin "Book for User" action: looks up the guardian's real
  // Cognito identity by email and writes the Booking/BookingHistory rows
  // directly (bypassing the model rules above) so they're owned by the
  // guardian, not the admin invoking this mutation. See handler.ts for the
  // fallback behavior when no account exists for that email.
  bookForUser: a
    .mutation()
    .arguments({
      sessionId: a.id().required(),
      sessionDate: a.string().required(),
      sessionTime: a.string().required(),
      sessionTitle: a.string().required(),
      guardianEmail: a.string().required(),
      guardianName: a.string().required(),
      mode: bookingMode,
      playerName: a.string().required(),
      playerName2: a.string(),
    })
    .returns(a.customType({
      id: a.string().required(),
      userName: a.string().required(),
      userEmail: a.string().required(),
      // Plain string, not the shared `bookingMode` enum - reusing that same
      // enum builder for a customType's return field (rather than a model
      // field or mutation argument) confuses its generated handler type.
      // The value is just for admin.js to display, so strict enum typing on
      // the way out isn't needed.
      mode: a.string(),
      playerName: a.string().required(),
      playerName2: a.string(),
      attributedToGuardian: a.boolean().required(),
    }))
    .authorization((allow) => [allow.group('Admins')])
    .handler(a.handler.function(bookForUserFn)),

  // Backs Access Management: lists every Cognito user with their current
  // Admins-group membership. Admins-only, same as bookForUser above - see
  // amplify/functions/manage-users/handler.ts for how it's assembled.
  listAppUsers: a
    .query()
    .returns(a.ref('AppUser').array())
    .authorization((allow) => [allow.group('Admins')])
    .handler(a.handler.function(manageUsersFn)),

  // Grants/revokes Admins-group membership for a given user. Same Lambda as
  // listAppUsers (manage-users) - see handler.ts for the self-revoke guard
  // (an admin can't remove their own access through this mutation).
  setAdminRole: a
    .mutation()
    .arguments({
      username: a.string().required(),
      makeAdmin: a.boolean().required(),
    })
    .returns(a.customType({
      username: a.string().required(),
      isAdmin: a.boolean().required(),
    }))
    .authorization((allow) => [allow.group('Admins')])
    .handler(a.handler.function(manageUsersFn)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});

