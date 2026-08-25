# VocalClass Firebase setup

The frontend code is already pointed at project `vocalclass-66f4d`. A `permission-denied` error means Firebase Authentication succeeded, but the currently deployed Firestore rules rejected the read/write.

## Required one-time setup

1. Open Firebase Console for `vocalclass-66f4d`.
2. Enable **Authentication > Sign-in method > Email/Password**.
3. Create the default **Cloud Firestore** database.
4. Publish this repository's rules:

```bash
firebase login
firebase use vocalclass-66f4d
firebase deploy --only firestore:rules,storage
```

This repository includes `.firebaserc` and `firebase.json`, so the Firebase CLI knows to deploy `firestore.rules` and `storage.rules` to `vocalclass-66f4d`.

## First admin

Create one Auth user, copy that user's UID, and create this Firestore document manually in the Firebase Console:

```text
users/{uid}
```

```js
{
  uid: "<same uid>",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  status: "active"
}
```

Do not use a hard-coded admin email in the frontend. After the first admin document exists, `admin.html` can approve or reject teacher registrations.

## If permission denied continues

Open DevTools Console. The app logs whether the Firestore SDK failed and whether the REST fallback failed. The most common causes are:

- The rules in this repo were not deployed.
- The signed-in user does not have a matching `users/{uid}` document.
- The first admin document was not created manually.
- You are trying to open a teacher/admin page with a student or pending-teacher account.
