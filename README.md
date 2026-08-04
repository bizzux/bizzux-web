# Bizzux Website

Next.js 14 + Tailwind marketing site for bizzux.com.

## Pages
- `/` — Home (hero, problem/solution teaser, platform features, custom software teaser)
- `/platform` — Full Bizzux platform page (problem → feature → outcome breakdown)
- `/custom-software` — Custom software development service page
- `/contact` — Lead form, posts to `/api/contact`, which writes to Firebase Firestore (`leads` collection)

## Environment variables (set in Vercel project settings)
```
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```
These come from a Firebase service account key (Firebase Console → Project Settings → Service Accounts → Generate new private key).

## Local development
```
npm install
npm run dev
```

## Deploy
Push to GitHub, import the repo in Vercel, add the env vars above, deploy. Add `bizzux.com` as a custom domain in Vercel project settings once deployed.
