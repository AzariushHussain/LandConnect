# LandConnect Authentication Guide

This checkpoint implements registration, login, signed access tokens and a private current-user endpoint. It also supplies reusable role restrictions for the upcoming property-management endpoints. The Docker API has been rebuilt and the complete test suite passed 63 checks. The existing users table supports this stage, so no database migration was needed.

## 1 Follow a request through the code

```text
POST /auth/register
    request schema validates email password name and role
    auth service hashes the password and commits the user
    response schema returns the profile without its password hash

POST /auth/login
    auth service checks the submitted password against Argon2
    security helper signs a short-lived access token

GET /users/me with Authorization Bearer token
    dependency validates the token and looks up the user
    response schema returns that user's private profile
```

The new code follows the agreed structure. schemas/auth.py defines RegisterRequest, LoginRequest and TokenResponse; schemas/user.py defines the explicitly allowed profile fields. services/auth.py owns registration and credential verification. core/security.py owns hashing and token cryptography. api/deps.py owns authenticated-user lookup and role restrictions. api/routes/auth.py and users.py translate HTTP requests and responses. api/router.py registers both feature routers.

## What the endpoints return

POST /auth/register accepts JSON with email, password, display_name and optional role. It returns 201 and the new user's profile. The default role is buyer; seller and broker are also valid marketplace roles. An existing normalized email returns 409.

POST /auth/login accepts JSON email and password. It returns 200 with access_token, token_type set to bearer and expires_in measured in seconds. A wrong password and an unknown account both return the same generic 401 response.

GET /users/me requires a bearer token. It returns the authenticated user's ID, email, display name, role, privacy preferences and creation time. Missing, invalid or expired credentials return 401. The current profile is private to its authenticated owner; no public user directory was added.

All three successful responses use Cache-Control no-store. Password hashes are excluded by the response schema rather than relying on a caller to remember to remove them from an ORM object.

<!-- pagebreak -->

## 2 Understand validation and password storage

Registration normalizes valid email addresses to lowercase. This makes Person@example.com and person@example.com address the same account. PostgreSQL's unique constraint handles duplicate writes, including races between simultaneous registration requests. The service rolls back a failed write before checking for the conflicting account, then translates that conflict into the application's duplicate-email error.

Passwords must contain 12 through 128 characters during registration. Passwords are not stripped or silently changed; leading and trailing spaces are part of the credential. Display names are trimmed and must contain 1 through 80 characters. Only the documented request fields are accepted, so callers cannot supply a user ID, password hash or server-managed privacy fields during registration.

core/security.py uses pwdlib's recommended Argon2 hasher. The stored value is an Argon2id hash containing its salt and algorithm parameters. Login verifies the submitted password against that hash. It does not decrypt a password. A missing account still performs verification against a dummy hash to reduce timing differences; the dummy password can never authenticate a missing or empty stored hash.

Malformed stored hashes fail authentication. They do not become a successful login or an uncaught password-verification exception. Password request values use SecretStr, and the application validation-error handler returns only each error's type, location and message. It omits input and context fields, which could otherwise contain a submitted password.

## Understand access tokens

Tokens use the fixed HS256 signing algorithm and the server's JWT_SECRET. The issuer is landconnect and the audience is landconnect-api. Every token requires sub, iat, exp, iss, aud and token_use claims. sub is the user's UUID; token_use must equal access. The decoder checks the signature, allowed algorithm, issuer, audience and timestamps, and rejects an invalid UUID subject.

The expiration interval comes from ACCESS_TOKEN_MINUTES, which defaults to 60. The login response also reports that duration in seconds. JWT contents are readable, so the token contains no password, hash, email or role. Its signature prevents undetected changes; it is not encryption.

Application tokens are separate from the LiveKit room tokens planned for the calling stage. They use different purposes and authorization checks. Access to a future media room will require an authenticated account plus room membership.

Official password and JWT references
https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/
https://pyjwt.readthedocs.io/en/stable/api.html

<!-- pagebreak -->

## 3 Try the API in Swagger

Open http://localhost:8000/docs. The Docker stack should already be running. If needed, start it from the project root with docker compose up --build -d.

Expand POST /auth/register, select Try it out and submit this JSON. The example password is for local demonstration only; choose your own credential for an account you will keep.

```json
{
  "email": "buyer@example.com",
  "password": "a-long-demo-passphrase",
  "display_name": "Demo Buyer",
  "role": "buyer"
}
```

A successful registration returns 201. To register a seller or broker instead, use the corresponding role and a different email. Submitting the same normalized email again returns 409.

Next expand POST /auth/login and submit:

```json
{
  "email": "buyer@example.com",
  "password": "a-long-demo-passphrase"
}
```

Copy the access_token from the response. Select Authorize near the top of Swagger, paste the token alone into the HTTPBearer field and authorize. Swagger adds the Bearer prefix automatically. GET /users/me should now return your own profile. An ordinary API client must send the complete header:

```text
Authorization: Bearer <access_token>
```

This login endpoint deliberately accepts JSON. It is not an OAuth2 password-form endpoint. The mobile client can send the same JSON payloads and store the resulting token using the platform's protected credential storage when that client is implemented.

## Apply roles to future endpoints

CurrentUser resolves a validated token to the current database user. require_roles accepts permitted roles and returns a dependency for a protected operation. For a seller/broker operation, the endpoint will use:

```python
from typing import Annotated
from fastapi import Depends
from app.api.deps import require_roles
from app.models import Role, User

ListingManager = Annotated[
    User, Depends(require_roles(Role.seller, Role.broker))
]
```

An authenticated buyer receives 403 from such an operation. Roles are read from PostgreSQL on every request, so a stale or additional role claim in a token cannot grant access. The guard is tested with test-only routes; production listing routes will be added in the next stage.

<!-- pagebreak -->

## 4 Review the checks and stage limits

The complete suite passed 63 tests, including three PostgreSQL integration tests in isolated schemas. The auth coverage includes all registration roles, default buyer role, normalized-email conflicts, input limits, forbidden fields, preserved password whitespace, safe output fields, malformed stored hashes, wrong credentials and successful login/profile access.

Token tests reject expired, incorrectly signed, unsigned and wrong-algorithm tokens, missing required claims, wrong issuer/audience/purpose, malformed subjects and future issue times. A deleted user's token is rejected. Role tests allow sellers and brokers, deny buyers and demonstrate that current database roles take precedence over token claims.

The live Docker smoke check verified registration 201, duplicate registration 409, login 200, profile 200, unauthenticated profile access 401 and invalid-input validation 422. It also checked Swagger's bearer security definition and the stored password hash. The generated smoke-test account was removed afterward. The API and database reported healthy; the migration service exited successfully.

## Run verification yourself

```powershell
uv run --project backend ruff check backend scripts
uv run --project backend ruff format --check backend scripts
uv run --directory backend python -m pytest -q
uv run --directory backend python -m alembic check
```

The plain test command skips the three PostgreSQL tests unless TEST_POSTGRES_URL is supplied. The README provides a complete-suite command that loads the development database URL from settings without printing credentials. The PostgreSQL user needs permission to create and remove the tests' isolated schemas. Lint and formatting checks passed. The installed TestClient continues to emit one upstream HTTPX deprecation warning.

## What remains outside this stage

This checkpoint supplies stateless access tokens. It does not yet include refresh tokens, immediate logout revocation, password recovery or email verification. Until it expires, an issued token remains usable while its user exists. The current registration flow allows users to choose their marketplace role; it does not certify a seller's identity or ownership of land.

Authentication throttling is still a deployment requirement before public exposure, alongside HTTPS. The prototype's Compose ports remain bound to loopback. These limits should be addressed when preparing a hosted deployment; the local assignment prototype should not be described as a fully hardened production authentication service.

The next stage is community browsing and property management: listing create/edit/archive, ownership restrictions, filters, property images and validated map coordinates. Say next to implement that stage. Messaging, meeting rooms and LiveKit SFU calling remain scheduled afterward.
