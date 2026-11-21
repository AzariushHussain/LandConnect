# LandConnect Listings Guide

The authentication stage was committed as d391b3d before this work began. This checkpoint adds community browsing, owner-managed property listings, safe image uploads and geographic queries. The complete suite passed 121 tests, including four PostgreSQL integration tests. The rebuilt Docker API also passed a full listing and image workflow. The existing schema supports these features, so no migration was added.

## 1 Understand the implemented flow

```text
Seller or broker logs in
    create a draft with location price area and description
    upload property images
    publish with PATCH status active

Community visitor
    browse active listings with filters
    view details and property images
    request map points for a visible geographic area

Owner manages a property
    edit fields or mark it sold
    archive it with DELETE
    restore its status later if needed
```

api/routes/listings.py defines HTTP routes and ownership dependencies. schemas/listing.py validates listing data, filters and response fields. services/listings.py owns queries and database writes. services/media.py validates, normalizes and stores images. api/middleware.py enforces a request-body size cap before oversized bodies can finish parsing.

GET /listings returns active properties. GET /listings/map returns active properties as a paginated GeoJSON FeatureCollection. GET /listings/mine returns the authenticated seller or broker's own properties, including unpublished ones. All three support search, location, amount and area filters.

POST /listings requires a seller or broker and returns 201. The owner ID comes from the authenticated user. PATCH /listings/{id} updates supplied fields. DELETE /listings/{id} archives the property and returns 204; it does not permanently erase the record or its images.

POST /listings/{id}/images accepts one multipart file and returns its ID and relative download URL. GET on that image URL returns normalized JPEG bytes, subject to listing visibility. DELETE on it removes the image and returns 204. The interactive API documentation is at http://localhost:8000/docs.

<!-- pagebreak -->

## 2 Apply ownership and privacy correctly

The public community feed contains only active listings. Draft, sold and archived listings are visible only to their owner through authenticated requests. A GET on a nonpublic listing returns 404 for an anonymous visitor or another account. If a bearer token is supplied, it must be valid; an invalid token returns 401.

Image access follows the same policy on every request. A previously known image URL does not bypass the visibility check. An image ID must also belong to the listing in its URL. Files are not mounted as an unrestricted static directory. Detail responses, private owner collections and image responses use no-store caching to avoid serving stale private content from an HTTP cache.

Creation and management require the seller or broker role. Ownership is checked in addition to role, so one seller cannot edit another seller's property. Non-owner management attempts return 404; a buyer attempting a management operation receives 403. Requests cannot override owner_id, listing ID or server-generated timestamps.

Public responses include the owner's account ID, display name and role. They omit the owner's email, password hash and private account settings. This leaves an account identity for the future in-app messaging flow without publishing contact details.

## Validate data before writing

Titles, descriptions, addresses, cities and states must contain nonblank text within their documented limits. Prices and areas must be positive, fit the database's fixed precision and contain at most two decimal places. Area is stored in square metres. Currency uses an uppercase three-letter format and country uses an uppercase two-letter format. These format checks do not verify legal ownership or convert currencies.

Latitude ranges from -90 through 90 and longitude from -180 through 180, with at most six fractional digits. The mobile location picker can round selected coordinates to that precision. A partial update must provide at least one supported field; explicitly setting a field to null is rejected. Fields omitted from PATCH retain their previous values.

## Listing states

New properties default to draft. Owners may set active to publish, sold to remove an available property from the community, or archived to retain it privately. DELETE chooses archived. Owners can use PATCH to change a retained listing back to active or draft. This prototype does not enforce a requirement to upload an image before publication.

<!-- pagebreak -->

## 3 Try creation publication and map browsing

Register or log in as a seller or broker, then authorize Swagger with the returned access token. POST /listings accepts a JSON body such as:

```json
{
  "title": "Roadside land near Bengaluru",
  "description": "Land with road access",
  "price": "1500000.00",
  "currency": "INR",
  "area_sq_m": "500.00",
  "address": "Example road",
  "city": "Bengaluru",
  "state": "Karnataka",
  "country": "IN",
  "latitude": "12.971599",
  "longitude": "77.594566"
}
```

The response contains the listing ID and default draft status. Use POST /listings/{id}/images, select a property image in the file field and submit it. Each request uploads one file. The returned URL is relative to the API host. Use the owner's Authorization header to preview it while the property is unpublished.

Publish with PATCH /listings/{id} and the body below. The listing and its images will then be publicly readable.

```json
{"status": "active"}
```

Browse matching properties or request their map points:

```text
GET /listings?city=Bengaluru&currency=INR&limit=20
GET /listings/map?south=12&north=13&west=77&east=78
GET /listings/mine?status=draft
```

Map geometry is a Point with numeric coordinates in longitude-then-latitude order, such as [77.594566, 12.971599]. Listing detail coordinates and decimal amounts are JSON strings to preserve decimal precision. A map client should use geometry coordinates rather than treating a price or area string as a floating-point location.

The backend supplies validated locations and map data. The React Native map view and location-selection interface will be implemented with the mobile application. No map renderer or geocoding provider has been added to the backend.

<!-- pagebreak -->

## 4 Understand filtering and image handling

The q filter searches title, description and city using a case-insensitive literal substring. Percent and underscore characters are escaped rather than acting as wildcard operators. City, state, country and currency filters match case-insensitively after their input format is validated. Min/max price and area filters use stored values; choose a currency when comparing amounts because there is no exchange-rate conversion.

A bounding box must provide south, north, west and east together. South cannot exceed north. A west value greater than east represents a box crossing the international date line. Map queries and community queries share these filters, so map markers follow the same public-visibility and search rules.

Pagination uses limit and offset with newest listings first and ID as a tie breaker. The default limit is 20, the maximum is 100, and offset is bounded to 0 through 10000. The total is the filtered count, not just the number in the page. Map results are paginated too; a mobile map must request additional pages if it wants every matching marker. Only the owner collection accepts a status filter.

## The upload pipeline

Each listing supports at most 10 images. Each uploaded image must be at most 5 MiB and 12 million pixels. JPEG, PNG and WebP content is decoded and checked; file extensions and declared media types are not trusted. Animated images are rejected. A separate 6 MiB total request-body limit covers multipart overhead and also applies to streamed requests.

The image's EXIF orientation is applied, it is resized to fit within 2048 by 2048 pixels, and fresh JPEG pixels are written without the original metadata. Transparent areas are flattened onto white. Generated filenames use random UUIDs. Original filenames and filesystem paths are not returned to clients. Download responses declare image/jpeg and disable content-type sniffing.

The relative UPLOAD_DIR is anchored to the backend directory, independently of the command's working directory. Docker uses its persistent uploads volume. Uploads hold a lock on the parent PostgreSQL listing row so management operations and image-count checks are serialized for that property.

## File and database failure handling

If writing or committing an upload fails, the service rolls back and removes the newly created file. Deleting an image commits metadata removal before attempting file removal; once its database reference is gone, the API cannot serve it. A failed cleanup is logged. A process crash can still leave an unreferenced file because filesystem writes and database commits are not one transaction. Sustained or multi-instance deployments need reconciliation and shared storage.

Official upload and image references
https://fastapi.tiangolo.com/tutorial/request-files/
https://pillow.readthedocs.io/en/latest/reference/Image.html

<!-- pagebreak -->

## 5 Review verification and continue

All 121 tests passed. New coverage includes seller/broker creation, rejected buyer operations, owner-only edits and archiving, draft/sold/archive privacy, optional bearer-token validation, safe owner summaries, literal searches, amount and location filters, bounds crossing the date line, numeric map coordinates and bounded pagination.

Image tests cover metadata removal, EXIF orientation, resizing, transparency, invalid formats, oversized bytes/pixel counts, maximum image count, unauthorized downloads/deletion, substituted image IDs, path validation and cleanup after a failed database commit. Request-size checks cover both declared and streamed bodies. Existing authentication and migration checks also passed.

The PostgreSQL listing test ran create/upload/publish/map/archive/delete-image operations against an isolated schema. The live Docker smoke test exercised the same workflow through HTTP and verified that archived images became private. Its generated property and account were removed afterward. Both the API and database reported healthy, and the migration service exited successfully.

```powershell
uv run --project backend ruff check backend scripts
uv run --project backend ruff format --check backend scripts
uv run --directory backend python -m pytest -q
uv run --directory backend python -m alembic check
```

The plain pytest command skips four PostgreSQL tests unless TEST_POSTGRES_URL is set. The README contains a command enabling the complete suite using the development connection settings. Integration checks create and remove their own schemas; they do not downgrade application tables. Ruff checks passed. The installed TestClient still emits its existing upstream HTTPX deprecation warning.

## Current limits and the next stage

The existing schema was unchanged. Coordinates use regular numeric columns and bounding-box filters, rather than a spatial database extension. The prototype has no geocoding, distance-radius search, advanced map clustering, property verification or currency conversion. Offset pagination can shift when listings change between page requests; large feeds should use cursors. The image-storage crash-recovery limitation is described on the previous page.

The authentication checkpoint is committed. This new listings checkpoint remains uncommitted for review. The next implementation stage is private messaging and communication privacy controls. That will connect conversations to account identities, persist message history and enforce membership and contact preferences. Meeting rooms and LiveKit SFU audio/video calling remain scheduled afterward. Say next to continue.
