# Demo data and test accounts

Created against the running private development API on 23 November 2026. There are two accounts per supported role, six accounts total. All six logins were verified through the real authentication API. Existing accounts, databases and uploads were not reset.

## Accounts

| Role | Account 1 | Account 2 |
| --- | --- | --- |
| Buyer | buyer1@example.com | buyer2@example.com |
| Seller | seller1@example.com | seller2@example.com |
| Broker | broker1@example.com | broker2@example.com |

All six use the demo password: **LandConnect@123**.

Profiles are named Demo Buyer/Seller/Broker 1 or 2. These are synthetic development accounts with a shared demo password, not production credentials.

## Sample content

Each seller and broker owns two active properties, one private draft and one sold property: 16 total, with 8 visible in the community/map. Sample locations are around Pune, Bengaluru, Hyderabad and Chennai. All 16 properties have generated JPEG illustrations explicitly labeled as synthetic. Addresses, prices and descriptions are examples, not real offers.

Seven direct conversations contain two messages each. Buyer 1 and Buyer 2 can contact each other immediately for a two-device call test. The six-person **[LC DEMO] LandConnect Community** group is owned by Buyer 1, with Seller 1 as an additional admin. **[LC DEMO] Pune Site Visit** connects Broker 1, Buyer 1 and Seller 1, with Broker 1 as owner. There are 23 sample messages across these conversations.

**[LC DEMO] Land Discussion** is a video meeting hosted by Broker 1, inviting the other five accounts. **[LC DEMO] Buyer Briefing** is an audio meeting hosted by Seller 2, inviting Buyer 2 and Broker 2. Invitations are not automatically accepted: open Meetings, accept and explicitly join media. No active calls or live SFU rooms were created by seeding.

## Trying the roles

Sign out of the current phone account and sign in with one of the emails above. Buyers can browse listings, maps, chats and meetings; listing-management access is denied. Sellers and brokers also have My account > My properties with their own active, draft and sold examples.

For direct calling, use Buyer 1 and Buyer 2 on separate devices and open their existing direct chat. For group meetings, use Broker 1 as the video host and Buyer 1/Seller 1 as invitees. Seeding verifies credentials and data access, not real-device media playback.

## Reusing the seed helper

From the repository root, with the backend running:

```powershell
uv run --project backend python scripts/seed_demo.py --base-url http://192.168.29.22:8000
```

Use the PC's current private address if Wi-Fi changes. The script accepts only localhost/private IP origins. It uses normal registration/login, property/image, chat/message and meeting APIs, preserving server-side role/privacy checks and transactional notifications.

Existing accounts are reused only when the password, expected role and demo display name match; conflicting profiles are not overwritten. Existing named properties/groups and images are reused. Stable message/meeting UUIDs prevent duplicate creation on reruns. Existing demo edits, group permissions and consent changes are not reset. If privacy/block settings prevent seeding, the script reports the failed action instead of overriding those preferences. Renamed/deleted fixtures may be recreated on a later run.

LANDCONNECT_DEMO_PASSWORD can select a different password before the first seed. Changing this variable does not reset existing passwords. The default shared password above is deliberately documented for local demo use.

## Verification

The first run created 6 accounts, 16 listings/images, 7 direct chats, 2 groups, 23 messages and 2 meetings. A second run reused all fixtures and created no duplicates. Both runs verified account roles, buyer denial of listing management, active-only community visibility, map data and a downloadable JPEG. Private-origin guards, deterministic UUIDs and JPEG generation were also checked. Ruff formatting/lint passed.
