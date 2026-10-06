# VocalClass classroom upgrade

## What is implemented

- One shared classroom for all four legacy classroom URLs; the existing teacher and student dashboard links still work.
- Teacher/student two-way camera and microphone using WebRTC, with separate teacher screen video so sharing does not replace the microphone or camera.
- Device checks, permission error messages, listen-only joining, browser audio-unlock button, microphone/camera toggles, fresh reconnect identities, queued ICE candidates, generation-scoped negotiation, ICE restart, listener/track cleanup and heartbeat-based presence.
- Side-by-side lesson and videos on desktop; stacked mobile layout. The screen-share button can share a PDF opened in another window/tab; there is no document upload/storage service.
- Shared pen, highlighter, eraser, line, rectangle, ellipse, text, undo/redo, clear and board download. Completed strokes sync once per stroke. Board geometry uses a consistent 1600×900 coordinate system and survives resize.
- Classroom chat, persistent raised hands, participant list, attendance CSV, two-option quizzes/polls, response counts and a per-question correct-answer leaderboard.

## Before deploying

This is a tested small-class implementation, not a complete Vedantu replacement. Production Firebase access and a TURN service were not available during development. The GitHub branch does not configure either service automatically.

1. Review and merge `firestore-classroom.rules` into the existing Firebase rules for project `vocalclass-66f4d`. It is an integration example, not a wholesale replacement: preserve existing account, activation-code creation, teacher-login and administrator rules. Remove broad overlapping allows for the new classroom paths; Firestore allows are additive. Validate the combined rules in the Firebase Emulator before publishing. No production rules have been read or changed. The available local Java 8 installation could not run the current emulator, so these rules have not been emulator-validated.
2. Ensure Anonymous Authentication is enabled for students and that your deployed domain is authorized. Teachers must already be signed in and own the activation code. Serve over HTTPS (GitHub Pages does this).
3. Configure a TURN relay. The checked-in configuration has STUN only and cannot guarantee connectivity across restrictive networks. Set `iceServerEndpoint` in `classroom-config.js` to an HTTPS backend that validates the Firebase bearer token and returns short-lived TURN credentials as `{ "iceServers": [{ "urls": ["turns:your-relay:443?transport=tcp"], "username": "temporary-user", "credential": "temporary-password" }] }`. Configure CORS for the exact deployed origin and handle OPTIONS. Keep provider keys and shared TURN secrets on the backend, never in GitHub or browser code. Endpoint failures are visible and do not silently fall back.
4. Test a teacher laptop and student phone on different networks: allow media, verify real sound in both directions, mute/unmute, share and stop sharing, join late, refresh/reconnect, end class. Test Safari/iOS separately. Automated tests use Edge and simulated media; they do not verify physical speakers, Safari, production authentication, deployed rules or TURN.
5. Merge the pull request only after backend setup is verified, then verify the GitHub Pages deployment. This change has not been merged or published.

## Capacity and retention

The teacher maintains one peer connection per student. The configured video-seat limit is eight; it is a client resource bound, not a server-enforced admission policy or a load-test guarantee. Larger classes need an SFU such as a managed conferencing service, server-side admission and load testing. Students receive the teacher camera/screen and see themselves; this is not an all-student video mesh.

Session documents separate previous meetings and reconnects. Heartbeats run every 15 seconds; inactive participants disappear from the live roster after 60 seconds. A tab crash cannot guarantee an immediate database cleanup. Add scheduled deletion/retention for old sessions, candidates, chat and attendance before extended production use.

The board is bounded to 180 strokes / 400 KB serialized data to stay below Firestore document limits. Save it before clearing when full. Quizzes are classroom participation activities, not secure graded exams: answers and participation are visible to authenticated classroom users, and the correct answer is published on close. There is no payment system, recording service, course catalogue, homework system, moderation backend, verified attendance identity or cross-question achievement system in this change.

## Regression test

Install Node.js and run `npm install`, then `npx playwright install chromium` and `npm run test:classroom`. Optionally set `PLAYWRIGHT_CHANNEL=msedge` to use installed Edge. The test starts its own localhost server on port 4175, uses a mock database adapter (not production Firebase), and creates real peer connections with fake camera/microphone tracks. No real classroom data is written. Screenshots go into `tests/artifacts/`.

Tests cover both directions of RTP audio/video, unmuted audio playback recovery, permission-denied receive-only joining, screen sharing while camera/audio continue, late joins, ICE restart, student reconnect, camera toggles, chat escaping, raised hands, board strokes/shapes/undo/redo, quiz responses/results, four viewport widths, end-class propagation and peer cleanup.

Reference patterns: [WebRTC peer connections](https://webrtc.org/getting-started/peer-connections), [TURN requirements](https://webrtc.org/getting-started/turn-server), [ICE candidate ordering](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addIceCandidate), [Vedantu live learning tools](https://www.vedantu.com/online-tuition).
