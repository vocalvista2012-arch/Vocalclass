# VocalClass — Firebase free-plan edition

The website now uses Firebase Authentication, Firestore and browser WebRTC. It does not call Cloud Functions, Cloud Tasks, Cloud Run or Firebase Storage. No billing upgrade is needed for this implementation. Firebase's free quotas still apply: long lessons, many viewers and frequent document updates can exhaust those quotas. This is a small-class application, not an unlimited-capacity service.

## Publish

1. Sign in using `npx firebase-tools login` with access to `vocalclass-66f4d`.
2. Deploy the rules with `npx firebase-tools deploy --only firestore:rules --project vocalclass-66f4d`.
3. Publish this version of the website through GitHub Pages. Keep Email/Password Authentication enabled and authorize the website's domain in Firebase Authentication.

The default `firebase.json` deploys only Firestore rules. The `functions/`, `converter/`, and Storage rule files are archived alternatives and are not used by the free edition. Do not follow the former paid deployment instructions in CLASSROOM-UPGRADE.md.

## What works

- Private teacher quiz libraries and personal teacher/student profiles.
- A–D answers, 1–60-second timers, pause/resume, previous/next/skip/end and answer reveal.
- Top 10 correct answers, cumulative class-code scores, participation points, teacher bonuses and badges.
- Teacher microphone/camera/drawing/screen-sharing permissions, removal, two-way video/audio, chat and whiteboard tools.
- Local PDF viewing with page navigation, zoom and full screen. Click **Share screen** and select the classroom tab/window to present the PDF. Export PowerPoint to PDF first. Documents are not uploaded or automatically downloaded to student devices; students see the teacher's screen share.

## Timing and trust

Keep the teacher's classroom tab open. It finalizes expired questions and grades answers. Browser suspension or closing the tab delays results; Firestore rules still reject late answers against the saved deadline. Starting a replacement classroom creates a new session and does not automatically recover unfinished grading from an old session.

The app estimates clock offset with a Firestore server timestamp at join and every five minutes. Deadline enforcement and answer submission timestamps are checked by Firestore. Ranking uses those stored timestamps, including the question's pause-adjusted segment. It reflects network arrival time, not exact human reaction time.

Firestore rules prevent students from reading private answer keys, changing teacher controls or writing scores. The teacher's browser is the grading authority, so this edition is unsuitable for high-stakes exams. A teacher can modify their own class data using a modified client. It has no independently trusted server grader.

Each graded round has an idempotency marker. Repeating an earlier question creates a new scored round. Cumulative scores persist per class code; badges are privately visible in a student's dashboard and publicly shown only when the teacher enables them. Badge records are scoped by class code so one teacher cannot overwrite another class's award.

WebRTC uses direct peer connections with up to eight student video seats. Some networks require a TURN relay; this edition does not include a paid relay or guarantee connectivity on every network.

## Verification

- `npm run test:syntax`: frontend syntax.
- `npm run test:free`: free-plan action handlers with a memory database.
- `npm run test:rules`: real browser Firebase SDK against local Auth/Firestore emulators. Start `npx firebase-tools emulators:start --only firestore,auth --project demo-vocalclass-test` first, with Java 21 or newer. Tests use only the demo project and clear its emulator documents at startup.
- `npm run test:classroom`: real WebRTC with synthetic devices and mocked signaling; includes student screen permission/revocation, mute-all, reconnect, denied devices and cleanup.
- `npm run test:quiz-ui`, `npm run test:presentation`, `npm run test:dashboard`: browser interface and profile checks. PDF tests verify local rendering without Storage uploads.

Set `PLAYWRIGHT_CHANNEL=msedge` to use installed Edge. Actual cameras, speakers, mobile Safari and separate networks still need real-device checks. Tests do not create production user accounts or quiz records.
