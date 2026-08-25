<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyD2WCO8qa17uGaA88x31AT-wSOEbEvAOOI",
    authDomain: "vocalclass-66f4d.firebaseapp.com",
    projectId: "vocalclass-66f4d",
    storageBucket: "vocalclass-66f4d.firebasestorage.app",
    messagingSenderId: "885399749203",
    appId: "1:885399749203:web:c38cd8d8c53e1c11cbbca6",
    measurementId: "G-17Y2R4S565"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>
