export const classroomConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  // HTTPS service: validates a Firebase ID token and returns short-lived
  // { iceServers: [{urls: [...], username: '...', credential: '...'}] }.
  // Never put a provider API key or long-lived TURN password in this repository.
  iceServerEndpoint: null,
  // Deployed Cloud Run /convert URL; PPT/PPTX are displayed as PDF slides.
  presentationConverter: null,
  maxStudents: 8,
  heartbeatMs: 15000,
  staleAfterMs: 60000
};
// Functions and the PPT conversion service must be deployed before use.
