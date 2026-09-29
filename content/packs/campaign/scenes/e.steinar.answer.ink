# draft
// FIRST DRAFT (game phase 8, docs/tech-spec.md §74): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// Night 10, after Ulf asked: what you can tell him depends on whether you looked at Steinar's back (steinar_back).
EXTERNAL flag(name)
{ not (flag("steinar_judged") || flag("steinar_back")): -> never }
Ulf's letter is one line, pressed hard into the bark. "Well? Did you see him?" # speaker: ulf
{ flag("steinar_back"): -> saw }
-> blind

=== saw ===
You saw the wound. It was in his back, and he told you it wasn't.
{ flag("steinar_valhalla"): You sent him to Odin's benches all the same. }
* [Tell Ulf the truth.]
  # fx: flag told_ulf_truth
  You write it plainly: the wound was in his back. He ran, and then he said he didn't.
  "Then his mother keeps her coin, and I keep this," Ulf writes. "Thank you. I think." # speaker: ulf
* [Tell Ulf he died facing them.]
  # fx: flag told_ulf_kind
  You write that Steinar died facing them, as the cousin said.
  "Good," Ulf writes. "Good. I'll tell his mother." # speaker: ulf
- -> END

=== blind ===
You never looked at his back. You were busy, or you forgot, or you didn't want to know.
{ flag("steinar_promised"): You'd promised him you would. }
* [Tell Ulf you didn't look.]
  # fx: flag steinar_unknown
  "Then nobody knows but him," Ulf writes. "And he isn't telling." # speaker: ulf
* [Tell Ulf he died facing them.]
  # fx: flag told_ulf_kind
  You write that Steinar died facing them. You don't know that. Ulf does, now.
- -> END

=== never ===
"Steinar never came to you?" Ulf writes. "Then maybe he's still walking. That's worse." # speaker: ulf
-> END
