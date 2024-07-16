let mediaRecorder;
let audioChunks = [];
const recordButton = document.getElementById('recordButton');
const stopButton = document.getElementById('stopButton');
const audioPlayback = document.getElementById('audioPlayback');

recordButton.addEventListener('click', startRecording);
stopButton.addEventListener('click', stopRecording);

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  
  mediaRecorder.start();
  recordButton.disabled = true;
  stopButton.disabled = false;

  mediaRecorder.ondataavailable = event => {
    audioChunks.push(event.data);
  }
}

function stopRecording() {
  mediaRecorder.stop();
  mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
    audioChunks = [];
    const audioUrl = URL.createObjectURL(audioBlob);
    
    audioPlayback.src = audioUrl;
    recordButton.disabled = false;
    stopButton.disabled = true;

    // Send audioBlob to server
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');
    fetch('/voice_recorder_upload', {
      method: 'POST',
      body: formData,
    }).then(response => response.text())
      .then(transcript => {
        console.log('Transcription:', transcript);
        document.getElementById("output").innerText = transcript;
      });
  }
}