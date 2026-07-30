# Sanitized static/runtime findings

## Reference media

- A 370x100 input image (aspect ratio 3.70) was prepared as a 1110x444 PNG
  (aspect ratio 2.50).
- The complete source image was proportionally scaled and padded. It was not
  stretched or cropped.
- The normalization runs in the browser. The upload API itself does not enforce
  the same image-dimension and aspect-ratio rules, so direct and legacy callers
  can bypass it.
- Selecting a file with an executable extension as an image produced a browser
  decoding exception without an actionable visible error.

## Voice capture

- Voice capture uses `MediaRecorder`, stops automatically at 14 seconds, and
  stops media tracks on component unmount.
- Audio files longer than 14 seconds are trimmed to the first 14 seconds before
  upload.
- Persona and Create Content show a filename/indicator, but no audio playback
  control is rendered after recording or upload.
- A browser without `MediaRecorder` support is reported as a microphone
  permission failure rather than an unsupported-browser condition.

## Caption post-production

- Generated video is downloaded and stored as raw media.
- Caption text is split into SRT cues and FFmpeg burns those cues into a final
  MP4.
- Raw MP4, final MP4, and SRT are stored separately when captioning succeeds.
- With an empty caption, the raw video is reused as the final video but an empty
  SRT object is still created.
- If download, SRT storage, FFmpeg, or final storage fails, the persistence
  helper falls back to the temporary provider URL. Callers still set the asset
  to `ready` and the queue item to `done`, while only recording a storage-error
  field. This can represent an uncaptioned or temporary asset as a successful
  final output.
- Re-polling an already completed task has no server-side post-processing lock;
  it can download, transcode, and store the same output again.

## Product Video Studio candidate

- Product Video Studio exists in the current branch but is absent from the
  deployed staging revision.
- Candidate direct KIE routes do not use the ContentAgent credit reservation and
  settlement pipeline.
- Candidate status polling accepts a syntactically valid provider task ID after
  login but does not verify that the ID belongs to the requesting user or
  workspace.
- Candidate generation uses a hard-coded no-text instruction rather than the
  current admin-managed global video rule.

## Analytics and UI state

- The Analytics engagement forecast is a hard-coded `4.8%`, not derived from
  stored source records.
- Refreshing the single-page frontend returns the user to Home rather than
  retaining the selected module.
- Existing Research data contains visibly corrupted separator characters.
- Existing failed video cards can show “Generating video” while their recorded
  status and error are already `failed`.
- Preview modals do not move focus into the modal, declare dialog semantics,
  trap focus, or implement Escape handling.
