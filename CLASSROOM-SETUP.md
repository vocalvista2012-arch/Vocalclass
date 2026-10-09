# VocalClass setup

Use [CLASSROOM-UPGRADE.md](CLASSROOM-UPGRADE.md) for the complete current deployment instructions, teacher/student workflows, scoring policy, permissions and feature limits.

The static website runs on GitHub Pages. Personal dashboards need the supplied Firestore rules. The new quiz engine and whiteboard saves also require the Firebase functions. Lesson uploads require Firebase Storage, and PPT/PPTX conversion requires the included Cloud Run service. Deploy and verify these services before merging the website update.

Email/Password Authentication supports both teachers and students. Registered users may teach without administrator approval. Application code remembers only an optional email address; Firebase manages sign-in persistence. Passwords are never saved by application code.

Configure TURN and test real devices on different networks before relying on live media. The current peer mesh is intended for small classes, with eight student video slots. See the upgrade guide for test commands and deployment checks.
