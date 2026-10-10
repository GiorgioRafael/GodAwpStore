export type CustomerEmailAuthMode = "login" | "signup" | "forgot" | "reset";

export type CustomerEmailAuthState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
};

export const INITIAL_CUSTOMER_AUTH_STATE: CustomerEmailAuthState = { status: "idle" };

/** Only set after exchanging the emailed recovery code for a session. */
export const CUSTOMER_RECOVERY_COOKIE = "gw_customer_recovery";
export const CUSTOMER_RECOVERY_MAX_AGE = 600;

/** Email links can take longer to open than an OAuth provider round trip. */
export const CUSTOMER_EMAIL_NEXT_MAX_AGE = 3_600;
