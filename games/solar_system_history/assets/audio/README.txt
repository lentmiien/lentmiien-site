NARRATION ASSET GUIDE

Each .txt file in this folder is the narration transcript for the milestone with the same name.

To add narration, generate an MP3 from the transcript and place it beside the text file. For example:

  chicxulub-impact.txt
  chicxulub-impact.mp3

No manifest or code change is needed. The simulation checks for the MP3 when its milestone begins, plays no more than one clip at a time, and keeps the story timeline paused until the clip ends or the viewer selects Continue.

Keep the basename and the .mp3 extension exactly as shown. Do not rename the existing .txt files unless you also update that milestone ID in js/events.js.
