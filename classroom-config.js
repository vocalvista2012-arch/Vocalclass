export const classroomConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  // HTTPS service: validates a Firebase ID token and returns short-lived
  // { iceServers: [{urls: [...], username: '...', credential: '...'}] }.
  // Never put a provider API key or long-lived TURN password in this repository.
  iceServerEndpoint: null,
  maxStudents: 8,
  heartbeatMs: 15000,
  staleAfterMs: 60000
};
