import { defineBackend } from '@aws-amplify/backend';
import type { Function as CdkFunction } from 'aws-cdk-lib/aws-lambda';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { bookForUserFn } from './functions/book-for-user/resource';

const backend = defineBackend({
  auth,
  data,
  bookForUserFn,
});

// defineFunction()'s resources.lambda is typed as the CDK IFunction
// interface, which doesn't expose addEnvironment() - it's really a concrete
// aws-cdk-lib Function underneath, so this cast is just recovering the type
// info Amplify's own typing narrows away.
const bookForUserLambda = backend.bookForUserFn.resources.lambda as CdkFunction;
const { tables } = backend.data.resources;

tables.Booking.grantReadWriteData(bookForUserLambda);
tables.BookingHistory.grantReadWriteData(bookForUserLambda);
bookForUserLambda.addEnvironment('BOOKING_TABLE_NAME', tables.Booking.tableName);
bookForUserLambda.addEnvironment('HISTORY_TABLE_NAME', tables.BookingHistory.tableName);
