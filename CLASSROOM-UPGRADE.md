# Archived paid-service implementation

**Superseded by [FREE-PLAN.md](FREE-PLAN.md).** The current website uses Firestore and the teacher's browser; Cloud Functions, Cloud Tasks, Storage and the converter below are not deployed or required. The remaining text documents the earlier implementation only.

This release adds the new classroom UI, a private quiz bank, server-controlled quiz timing and grading, teacher permission controls, and synchronized lesson documents. It is branded VocalClass powered by VocalVista. GitHub Pages serves the UI; the services below must be deployed separately. Publishing Firestore rules alone is not sufficient for this release.

## Deployment order

1. Use the existing Firebase project `vocalclass-66f4d`, default Firestore database and Email/Password Authentication. Cloud Functions, Cloud Tasks, Storage and the optional Cloud Run converter need the appropriate Google Cloud services and billing enabled. No paid service has been enabled or deployed by this change.
2. Install Node.js 22 and the Firebase CLI, authenticate to the project, then run `npm ci --prefix functions` from the repository. The local tests also run on Node 24; the deployed functions explicitly target Node 22.
3. Deploy the complete `firestore-classroom.rules`, `storage.rules` and the functions using `firebase deploy --only firestore:rules,storage,functions`. Preserve any unrelated rules added outside this repository. Approve Storage's cross-service Firestore access if Firebase prompts for it. Test the rules with current Firebase emulators and a supported Java runtime before production; the local machine only had an older Java installation.
4. Configure Cloud Tasks enqueue and invocation permissions for the functions runtime service account using the [Firebase task-queue guide](https://firebase.google.com/docs/functions/task-functions). `queueQuestion` is a retryable Firestore event that enqueues `expireQuestion` at the question deadline. This also works when the teacher closes their tab. Monitor function/task errors after deployment. Answers are rejected at the server deadline even if task execution is delayed; result publication can follow slightly later.
5. Initialize the configured Storage bucket and allow the website origin to download PDFs: `gcloud storage buckets update gs://vocalclass-66f4d.firebasestorage.app --cors-file=storage-cors.json`. The origin intentionally excludes URL paths. Downloads remain protected by Storage rules. Disabling a classroom in the dashboard closes its live room in the same transaction.
6. For PPT/PPTX uploads, deploy the `converter/` container to Cloud Run. Set `ALLOWED_ORIGIN=https://vocalvista2012-arch.github.io` and use a dedicated service account with the Firestore read access needed to check classroom ownership. The HTTP service verifies Firebase bearer tokens and classroom ownership before reading uploads. Set concurrency to 1, a 90-second timeout, 2 GiB memory and a small maximum instance count. It listens on `/convert`. Put that HTTPS URL in `presentationConverter` in `classroom-config.js`. The converter needs public HTTP reachability for the browser, but requests still require a valid Firebase token. Keep the converter isolated and its system packages patched.
7. Configure the existing authenticated TURN credential service in `classroom-config.js`. The default STUN-only setting does not guarantee calls across restrictive networks. Never put permanent TURN credentials in frontend files.
8. Verify a real teacher and two student accounts on separate devices/networks, then merge PR #2 and verify the GitHub Pages release. Firebase services, IAM, rules, conversion and the live site have not been deployed by this work.

## Teacher workflow

Open **Create quiz** in the dashboard. A quiz has 1–30 questions with four required answers A–D, a correct answer, a 1–60-second timer, 1–1000 points, an explanation and an optional answer-change setting. Add, duplicate, delete and reorder questions, then save. Use the class-code field to open a classroom. The selected quiz is preselected in the teacher's live quiz controls; starting still requires the teacher's explicit Start quiz action.

In class, use Start, Pause, Resume, Previous, Next, Skip and End. End returns the stage to the lesson; Show Fastest Finger or Show Correct Answer can display a completed question again. Students never receive teacher controls. Timer expiry locks answers and automatically publishes a correct-answer Top 10. Show/Hide Leaderboard and Show/Hide Badges control public visibility. Give bonus points and Award badge are teacher-only actions. A replayed question is a new scored round; Previous does not reverse already-awarded points.

Students choose one answer unless changes were enabled when the question was prepared. The final submitted choice and server receipt time determine ranking. Paused time does not count toward response time. Ranking reflects network arrival time, not a precise measurement of human reaction time.

## Scoring and saved data

The fastest correct answer receives the question's configured points (default 100). Each later correct rank loses 5% of the base, rounded to at least one point, with a 10% floor. Every accepted participation earns 5 additional points. Wrong answers receive no Fastest Finger points. The Top 10 table displays speed points; the cumulative leaderboard includes participation and teacher bonuses.

Cumulative scores persist under the class code across lesson sessions. “Quiz played” counts answered question rounds. Retry markers prevent one round being scored twice. Public leaderboard snapshots show up to 100 students. Raw scores and answer keys are not student-readable. Hidden leaderboard/badge snapshots contain no rows; information already viewed cannot be made unknown again.

Fastest Finger, five-correct streak, Knowledge Master (10 correct) and Quick Thinker (correct within 2 seconds) are automatic. The teacher can also award any listed badge, including Quiz Champion, Perfect Score and Top Performer. Earned badges appear privately in the account dashboard/profile area; public badge announcements require teacher visibility control.

## Media, permissions and whiteboard

Teacher camera appears above the student quiz panel. Cameras use a small-class peer mesh so students can also see classmates. The client limits video participants to eight students; this is not an SFU, a load-tested large classroom, or a server-enforced attendance limit. For larger classes, replace the transport with a managed SFU.

Microphones start locked for students. Allow Microphone enables the student's own button; the teacher never silently activates a device. Mute Student/Mute All turn off tracks and lock controls. Camera permission can be disabled or re-enabled, but the student must activate it. Only a student with explicit permission can share a screen. Teacher revocation stops the share and receivers suppress unapproved streams. Remove Student closes that lesson for the account and disconnects its media. Permission checks protect server writes; recipient-side media suppression also prevents ordinary modified senders from playing disallowed tracks in this client.

Whiteboard tools include pen, highlighter, eraser, pointer, text, line, rectangle, circle and arrow, colour/size, undo/redo and clear. Coordinates use one 1600×900 logical surface across screen sizes. Server revision checks reject conflicting saves instead of silently replacing another drawing. Students with drawing permission may append strokes; only the teacher can undo, redo or clear existing content. Pointer position is transient. Boards are bounded to 180 strokes / 400 KB.

## Lesson documents

PDFs render inside the classroom using pinned PDF.js 6.4.299. PPT and PPTX files convert through the included LibreOffice service to PDF slides; animations, embedded audio/video and interactive PowerPoint features do not play. A failed/unconfigured conversion gives an explicit PDF-export fallback. Limits: 15 MB source upload, 20 MB converted PDF, 200 pages. Pages, zoom, fit and close follow teacher state in Firestore. Full screen requires the local browser's user gesture. Student document-navigation controls remain hidden and server writes are teacher-only.

Keep lesson/session retention policies for old PDFs, signaling, chat and quiz records. No automatic deletion job is included because retention requirements were not supplied.

## Validation

- `npm run test:syntax`: frontend and inline scripts.
- `npm run test:quiz`: scoring/validation and actual function handlers with in-memory Firestore/Admin substitutes. Checks role enforcement, answer-key privacy in public state, timer scheduling, pause/resume, exact deadline rejection, answer changes, idempotent scoring, bonuses, permissions, removal and board conflicts.
- `npm run test:quiz-ui`: actual quiz and editor browser components with mocked API: A–D, timer urgency/format, expiry/pause locking, answer changes, Top 10, leaderboard visibility, save/duplicate/reorder and responsive layouts.
- `npm run test:presentation`: actual PDF.js rendering of a generated two-page file and synchronization between teacher/student tabs. Firebase Storage/server writes are mocked.
- `npm run test:dashboard` and `npm run test:auth`: account and profile regression checks.
- `npm run test:classroom`: actual WebRTC with synthetic cameras/microphones and an in-memory signaling service. The test polls serially to avoid flooding browser bindings. It exercises teacher/student media, drawing, quizzes, late screen-share joins, permitted student sharing, revocation, mute-all, reconnect and cleanup.

Browser tests require Playwright. `PLAYWRIGHT_CHANNEL=msedge` selects installed Edge. No test writes production data. Cloud Tasks/IAM, production security rules, real speaker output, cross-network TURN, Safari/iOS, Docker/LibreOffice conversion and high-concurrency classes still require deployment/device verification.

Implementation references: [Firebase callable functions](https://firebase.google.com/docs/functions/callable), [Cloud Tasks](https://firebase.google.com/docs/functions/task-functions), [Storage rule access limits](https://firebase.google.com/docs/rules/rules-behavior), [PDF.js examples](https://mozilla.github.io/pdf.js/examples/), [LibreOffice PDF conversion](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html).
