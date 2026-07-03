import { defineAuth, secret } from '@aws-amplify/backend';
import { bookForUserFn } from '../functions/book-for-user/resource';

// Replace the amplifyapp.com placeholder below with the real Amplify Hosting
// domain once it exists after the first deploy, then redeploy.
export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      google: {
        clientId: secret('GOOGLE_CLIENT_ID'),
        clientSecret: secret('GOOGLE_CLIENT_SECRET'),
        scopes: ['email', 'profile', 'openid'],
        attributeMapping: {
          email: 'email',
          fullname: 'name',
        },
      },
      callbackUrls: [
        'http://localhost:5173/sessions.html',
        'https://main.d17nxebfgblbv7.amplifyapp.com/sessions.html',
      ],
      logoutUrls: [
        'http://localhost:5173/index.html',
        'https://main.d17nxebfgblbv7.amplifyapp.com/index.html',
      ],
    },
  },
  groups: ['Admins'],
  // Lets bookForUserFn resolve a guardian's real Cognito identity by email.
  access: (allow) => [allow.resource(bookForUserFn).to(['listUsers'])],
});
