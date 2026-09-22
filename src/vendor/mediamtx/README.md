# MediaMTX WebRTC reader

`reader.js` is vendored without modifications from MediaMTX v1.21.1:
https://github.com/bluenviron/mediamtx/blob/v1.21.1/internal/servers/webrtc/reader.js

Copyright and license are in `LICENSE`. Keep the reader pinned to the tested
gateway version. It implements WHEP and ICE; the application owns video state
and tears down the reader when switching protocols or closing the preview.
