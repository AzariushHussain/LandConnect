# LandConnect Mobile Step 20

Login and signup design, validation and navigation

The My Account cleanup was committed as 812363b. This stage updates the login and signup screens and fixes a client-side character-count mismatch. These auth changes remain uncommitted for review.

## 1. Part A - A consistent form layout

Both screens now use the existing LandConnect brand and theme with a white form card, labelled icon inputs, a clear primary action and a compact link to the other form. The layout remains inside the existing safe-area, keyboard-avoiding and scrollable Screen component.

Login contains Email address and Password. Signup additionally contains Display name, Confirm password and account-type choices. Display name explains that it appears on the profile and in chats. The app does not request a separate legal name or invent a new username field.

Each input has a focus border and an inline error under its label/control. A submission collects errors for all invalid fields and focuses the first invalid text field in form order. Editing a field clears its old error and the server-error summary. Editing the password also clears a stale confirmation mismatch.

Password and confirmation have independent Show/Hide buttons. Both start masked, remain disabled during a request and reset to masked after an attempt or screen blur. Text-entry settings retain email/name/password autofill hints and disable password autocorrection/capitalization.

The keyboard moves from name to email to password, and from signup password to confirmation. Login's Go action submits the form. Confirmation's Done action dismisses the keyboard so the account-type choices and Create account action can be reviewed. Invalid forms do not issue an HTTP request.

## Account-type choices

Signup keeps Buyer, Seller and Broker choices, with Buyer selected initially. The choices now include an icon, radio semantics, selected state and a short explanation. Buyer focuses on finding land and contacting owners; Seller on creating/managing land listings; Broker on managing listings and connecting with clients. The existing backend role rules still determine access after signup.

AuthField.tsx implements the common labelled input, icon, focus/error treatment and visibility control. AuthScreen.tsx owns form values, request handling, role choice and navigation. The input references use the installed React Native version's TextInputInstance type.

<!-- pagebreak -->

## 2. Part B - Validation and request behaviour

The earlier JavaScript validation used string.length, which counts UTF-16 code units. The backend counts Unicode code points. For example, six single-code-point emoji can occupy twelve UTF-16 units, so the old signup check could accept a password that the backend rejected as too short.

Validation now uses Array.from(value).length for character limits. Signup requires 12 to 128 password characters and a trimmed display name of 1 to 80 characters. Login retains the backend's non-empty password rule, allowing existing credentials that are shorter than the signup minimum. Confirmation must match exactly. Passwords are never trimmed or normalized; leading/trailing spaces remain significant.

```typescript
const length = (value: string) => Array.from(value).length;
```

The native input limits allow enough UTF-16 units for those supported Unicode name/password values, while validation enforces the real character limits before submission. Email retains basic client checks, and the backend remains authoritative for its full email-format rules. Signup also rejects an unsupported role before sending it.

credentialErrors and registrationErrors return field-specific messages without echoing submitted values. The existing validateCredentials and validateRegistration helpers still expose a first-error string for their existing callers/tests.

## Submission, errors and navigation

A synchronous request lock prevents repeated submissions. Inputs, role choices, visibility controls and the form-switch link are disabled while a request is pending. Signup also guards navigation while its creation request is unresolved, then releases that guard before returning to login after success.

Confirmed signup returns to login with the email prefilled and an account-ready notice. It does not silently log in. The email also carries between forms when using their switch link. Passwords never go into route parameters, and password fields clear after an attempted request or when the screen loses focus.

A rejected login still shows the generic Incorrect email or password message. Duplicate signup email is identified beside the email field and in the summary, with the existing instruction to sign in. An uncertain network/server creation result advises trying login before resubmitting, since account creation may have reached the server. There is no automatic retry of account creation.

The existing SessionController still verifies the authenticated user and saves the token securely before unlocking private screens. This stage does not change token grants, expiry, secure storage or backend authentication.

<!-- pagebreak -->

## 3. Part C - Validation and manual checklist

All 207 mobile tests pass. Four new checks cover simultaneous field errors without submitted-value echoes, Unicode password minimum/maximum limits, Unicode display-name limits and unsupported roles, and login/signup rule differences with exact confirmation matching. Existing auth/API/session tests continue to cover invalid responses, generic errors, timeouts and session/storage safety.

TypeScript, ESLint, Prettier, git diff whitespace checks and Android development bundle export pass. The auth form's icon names were checked against the installed Ionicons glyph map. No dependency, backend code, migration or native module changed. No real account was created and the connected phone was not signed out for this verification.

The automated tests cover validation and existing session logic. They do not prove native autofill, focus movement, secure-entry toggling or navigation transitions on a physical device. Those checks remain pending under the earlier preference to skip phone UI checks.

## Login checklist

1. When ready to leave your current session, sign out and open login. Check the card layout, email/password labels and scroll behaviour with a larger system font and the keyboard open.

2. Submit an invalid email and empty password. Confirm both fields show errors, focus moves to the first invalid field and no request is sent. Correct them and use keyboard Next/Go. Test a rejected login and then valid demo credentials.

3. Toggle password visibility and confirm its label changes. Check OS autofill on the device. Move to signup and back, verifying that the email carries across and the password does not remain on the old screen.

## Signup checklist

1. Check Display name, email, both password fields and all three account roles. Verify each role's selected state/explanation and that keyboard Done exposes the remaining account choices.

2. Try a short password, mismatched confirmation, invalid email and empty name. Check inline errors and first-field focus. Check a Unicode name/password against the documented character limits, including exact password spaces.

3. Using a disposable account only when intentionally testing registration, submit once and confirm controls stay locked during the request. On confirmed success, verify login shows the email and success notice. Sign in and check the selected marketplace role.

4. Test duplicate email handling and cancel/back navigation before submission. During a pending signup request, verify the navigation guard and eventual release. If the result is uncertain, try login before repeating account creation.

No password-reset or social-login control was added, since those flows are not implemented by the current backend. The installed development client can receive this update through Metro without a new APK.

Reference: Expo SDK 58, https://docs.expo.dev/versions/v58.0.0/
