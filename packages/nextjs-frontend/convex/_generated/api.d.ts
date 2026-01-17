/* prettier-ignore-start */

/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev` in the convex-backend package.
 *
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/react";
import type * as actions from "../../../convex-backend/convex/actions.js";
import type * as messages from "../../../convex-backend/convex/messages.js";
import type * as sessions from "../../../convex-backend/convex/sessions.js";
import type * as streamHandler from "../../../convex-backend/convex/streamHandler.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * @example
 * ```ts
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  messages: typeof messages;
  sessions: typeof sessions;
  streamHandler: typeof streamHandler;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

/* prettier-ignore-end */
