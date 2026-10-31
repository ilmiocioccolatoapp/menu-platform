# Il Mio v4.2 Go-Live Checklist

This runbook records the Il Mio v4.2 production rollout: the multi-store schema, administrator roles, and Store ID login used by tablets. The rollout uses the existing `Ilmio-app` Supabase project and existing Vercel projects only.

## Release readiness

- [x] The local migration chain includes a legacy baseline, Il Mio data backfill, and legacy-route adoption monitoring.
- [x] The live legacy `Category` and `Product` schema was checked read-only against the baseline. Columns, defaults, foreign key, and RLS flags match. The unique `Category.id` key is represented as a constraint in Production, so the baseline and backfill migration now match and safely handle either constraint or standalone-index form.
- [x] The live catalog currently has 8 categories and 19 products; all product prices pass the migration format check, and products have valid legacy category references.
- [x] The Flutter flow uses Store ID and password, skips brand choice for one assigned menu, shows a selector for multiple menus, stores tokens with `flutter_secure_storage`, and expires offline access after 90 days.
- [x] A release migration removes direct Data API execute access from the existing Supabase `public.rls_auto_enable()` SECURITY DEFINER helper, if present, without removing its event trigger.
- [x] The signed version `2.1.0+9` APK candidate is at `mobile/build/app/outputs/flutter-apk/app-release.apk`; it points to the production API, which is now live.
- [x] The production API and admin are deployed at `https://ilmio-app.vercel.app` and `https://ilmio-admin.vercel.app`. `/healthz` and the admin login page return successfully; unauthenticated `/api/admin/me` correctly returns 401.
- [x] All four production migrations are applied to the existing `Ilmio-app` project, and catalog IDs and counts were verified after migration.
- [x] CBW now has its own owner organization and brand in the same project, separate from Il Mio Cioccolato. Its catalog is empty and it has no store assignment or brand administrator yet.
- [x] The admin workspace has one Brand selector across owners; changing it switches the active catalog. The Owner selector is shown only for store and owner management.
- [x] Supabase accepted the Platform Admin invitation request for `roobiinpandey@gmail.com`; a follow-up read-only check confirms the Auth email and active Platform Admin profile. No password was set or logged.
- [ ] The Super Admin should sign in at the admin page using the password chosen during setup. If setup is unfinished or the invite link expired, use **Forgot password** to receive a fresh password setup link.
- [ ] The Il Mio Brand Admin invitation and initial tablet Store ID password are still pending.
- [ ] CBW still needs its menu items, physical store assignment, and brand administrator account.
- [x] Removed production database, Auth, and Cloudinary settings from Vercel Preview. Production settings remain intact; Preview has no staging services and must not be used until configured with isolated values.
- [x] No staging Supabase project, branch, or paid plan was created.

Supabase leaked-password protection is not available on the current Free plan. The password setup page requires at least 20 characters; use a password manager to generate and store a unique password. No paid upgrade was made.

## 1. Existing Il Mio production setup

1. Use only the existing Supabase `Ilmio-app` project and the existing `ilmio-app` API and `ilmio-admin` Vercel projects. No additional project, database branch, or paid plan was created.
2. The production database dump was restored to disposable local PostgreSQL for migration and restore rehearsals. The integration suite passed 8/8 before the production migration. Keep future dumps and connection strings outside the repository.
3. Production credentials were removed from Vercel Preview. Preview is intentionally not configured for sign-in, invite scripts, migrations, or tablet API tests until isolated staging values are available.
4. Production API values are configured in the backend project. Keep `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `STORE_JWT_SECRET` server-side; never put them in the admin frontend or APK.
5. Supabase Auth allows the production password-setup redirect. The invitation request was accepted. The built-in email service is in use; no SMTP provider or paid add-on was configured.
6. Leaked-password protection requires Supabase Pro or above. The current setup stays on Free, so the admin password page enforces a 20-character minimum and recommends a unique password manager-generated password.

## 2. Production migration and verification (completed)

The production migration was rehearsed against a disposable local PostgreSQL restore of the existing `Ilmio-app` database. A protected production backup was taken before migration. Do not put secrets or dumps in this repository, command history, or the APK.

```sh
cd backend
npm ci
npm run db:backup -- /secure/path/ilmio-before.dump
npx prisma migrate status
```

For a copy of the existing legacy database with no Prisma migration history, first compare it to `prisma/migrations/202610300001_baseline/migration.sql`. Only if it exactly matches, record the baseline and apply the remaining migrations:

```sh
npm run prisma:baseline
npm run prisma:deploy
```

The second migration backfills the legacy catalog into the Il Mio organization, brand, store, and StoreBrand assignment in one transaction. It preserves the existing Category and Product IDs and fields, converts supported AED/EUR price strings into exact numeric amounts, creates the first published menu snapshot, and pins legacy menu routes to the Il Mio assignment. It stops before the backfill if prices are malformed, unsupported, or mix currencies. The fourth migration also removes public execute grants from the existing Supabase RLS event-trigger helper if that helper exists.

The baseline was compared with the live legacy schema and recorded, then migrations `202610300002_multi_owner_platform`, `202610300003_legacy_route_monitoring`, and `202610300004_revoke_public_rls_trigger` were applied. Post-migration verification confirmed:

- `Category` and `Product` row counts and original IDs match the pre-migration backup.
- Every category and product belongs to `legacy-ilmio-brand`, and every product still references its original category.
- `legacy-ilmio-store` has login code `ilmio-main`; `legacy-ilmio-main` links it to the Il Mio brand and has a current published menu snapshot.
- Both legacy routes preserve the catalog response and are recorded in `LegacyRouteHit` during the integration test.
- Store ID login, menu sync, publishing, and ownership boundaries pass the local integration tests.
- The live RLS helper event trigger remains installed, and direct public execute access to its SECURITY DEFINER helper is revoked.

The migrated local copy was also backed up and restored to a separate empty local database. This restore check expects the post-migration `MenuVersion` table:

```sh
npm run db:backup -- /secure/path/ilmio-after.dump
RESTORE_DATABASE_URL='postgresql://…/ilmio_restore_local' npm run db:restore-check -- /secure/path/ilmio-after.dump
```

## 3. Finish Super Admin sign-in

Configure the backend API environment in Vercel. `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` belong only in the backend project; never use them in the admin frontend or mobile app.

Required API values:

- `DATABASE_URL`
- `STORE_JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BOOTSTRAP_PLATFORM_ADMIN_EMAIL`
- `ADMIN_INVITE_REDIRECT_URL`
- `ADMIN_ORIGINS`
- `TRUST_PROXY_HOPS`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` when uploads are enabled

Production currently has `BOOTSTRAP_PLATFORM_ADMIN_EMAIL=roobiinpandey@gmail.com`. Keep this value until the account signs in successfully. Do not use Preview with production credentials or send test invites from Preview.

The dry run confirmed that the Auth user and profile did not exist. The invite command was run once against the existing `Ilmio-app` project, and Supabase accepted it. A follow-up read-only check confirms the Auth email is confirmed and an active Platform Admin profile exists. No password was created or logged. Do not rerun the invite script. The recipient should:

- Sign in at `https://ilmio-admin.vercel.app/login` with `roobiinpandey@gmail.com` and the password chosen during setup.
- If the password was not set or the invite link expired, choose **Forgot password** on the login page and follow the email link to set a unique password of at least 20 characters.

After the user confirms sign-in, verify `/api/admin/me` reports `isPlatformAdmin: true`, remove `BOOTSTRAP_PLATFORM_ADMIN_EMAIL` from Production, and redeploy the API.

## 4. Invite the Il Mio Brand Admin

After Super Admin access is confirmed, set `ILMIO_BRAND_ADMIN_EMAIL` to the existing Il Mio administrator email and use the `Ilmio-app` Supabase service-role key, publishable key, and database connection. The script creates/reuses the profile and `BRAND_ADMIN` membership and sends the setup or recovery email:

```sh
npm run admin:bootstrap-ilmio
npm run admin:bootstrap-ilmio -- --apply --send-setup
```

The script is idempotent for the matching account and brand. It stops if the profile is inactive or linked to a different Supabase user. It does not accept, store, or print a password. Confirm the administrator can sign in and manage only Il Mio before production rollout.

## 5. Initialize the Il Mio tablet login

Choose a unique store password of at least 6 characters and deliver it to the store operator through an approved password manager. Load it as `ILMIO_INITIAL_STORE_PASSWORD` in a protected operator shell. The script replaces only the one-time `!reset-required` migration placeholder with an Argon2id hash and refuses to overwrite an initialized password:

```sh
npm run store:init-ilmio
npm run store:init-ilmio -- --apply
```

The tablet signs in with Store ID `ilmio-main` and that password. The password itself is never printed or saved to the repository.

## 6. Build and test the APK

The production API is live. The current signed candidate already uses its production endpoint; rebuild only if a newer Flutter change needs to be included:

```sh
cd ../mobile
flutter pub get
flutter test
flutter build apk --release --dart-define=API_BASE_URL=https://ilmio-app.vercel.app/api
```

The release APK is written to `mobile/build/app/outputs/flutter-apk/app-release.apk`. Verify the APK signature and version, then test on a tablet:

- One assigned published brand opens directly to its gallery.
- Multiple assigned brands show the brand selector and each menu stays scoped to its assignment.
- Wrong store credentials fail without exposing whether the Store ID exists.
- Token refresh and logout work; a revoked store session is rejected.
- Offline menu access works for up to 90 days, then asks the device to reconnect.
- The legacy public routes remain pinned to Il Mio during the 30-day adoption window.

## 7. Remaining production rollout

1. Complete the Super Admin sign-in and remove the one-time `BOOTSTRAP_PLATFORM_ADMIN_EMAIL` setting afterward.
2. Invite the Il Mio Brand Admin and initialize the store password as described above.
3. Confirm `/healthz`, `/api/admin/me`, `/api/auth/store/login`, and `/api/menu` against production. Test tablet login with the real Il Mio store credentials.
4. Keep the legacy routes enabled and monitor the 30-day adoption report.

Do not retire `/api/categories` or `/api/products/available` until the 30-day monitoring gate is met and every managed tablet has moved to the authenticated app.
