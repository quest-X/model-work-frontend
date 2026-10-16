Daily Report Sans is a horizontal, unhinted, regular-weight TrueType derivative of Noto Sans SC.

Upstream: https://github.com/notofonts/noto-cjk
Pinned commit: f8d157532fbfaeda587e826d4cd5b21a49186f7c
Source: Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf
License: SIL Open Font License 1.1, reproduced in NotoSansSC-LICENSE.txt.

Preparation with fonttools 4.67.0: instantiate wght=400, retain all source Unicode cmap entries, remove hinting and OpenType layout features, rename the family Daily Report Sans. No character set reduction is applied. The font is loaded only when exporting PDF reports and embedded as a subset in the output.
