# Menu Platform

Menu catalog and publishing platform for multiple brands and physical stores. The repository contains:

- `backend/` — Express API, Prisma/PostgreSQL schema and reviewed migrations.
- `admin/` — React admin console with Platform, Organization, and Brand roles.
- `mobile/` — Flutter gallery and authenticated store tablet app.
- `docs/` — platform design and operational runbooks.

The current production target is Vercel. Render deployment files and instructions are archived. Start with [deployment and release procedures](DEPLOYMENT.md), including migration rehearsal and the legacy-route retirement gate.

## Local development

1. Configure and start PostgreSQL, then create `backend/.env` from `backend/.env.example`.
2. In `backend/`, run `npm ci`, `npm run prisma:deploy`, then `npm start`.
3. Configure `admin/.env.local` from the values in `admin/README.md`, then run `npm start` from `admin/`.
4. From `mobile/`, run `flutter pub get` and `flutter run`.

The backend serves the tablet API at `http://localhost:5001/api`; the React app runs at `http://localhost:3000`. Production credentials and migration steps are documented in [DEPLOYMENT.md](DEPLOYMENT.md).
