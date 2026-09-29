# draft
// FIRST DRAFT (phase 6): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// The shieldmaiden's last night (docs/tech-spec.md §72). It changes nothing: the ending follows from the run.
EXTERNAL flag(name)
EXTERNAL home(id)
{ not home("thurid"): -> gone }
You think of Thurid, because on a night like this you always stood next to her.
{
- flag("thurid_asked"):
  You asked her once to keep them. You never had to ask twice.
- flag("thurid_told"):
  You told her once that the stamp was heavier than a spear. It's heavier tonight.
}
{
- flag("wood") || flag("ferryman") || flag("loki_deal"):
  Wherever they are going tonight, she'll be walking at the back, where trouble comes from, {flag("thurid_kept"):with her sword drawn|with the wood axe on her shoulder}.
- else:
  She'll be sitting in your mother's doorway {flag("thurid_kept"):with her sword across her knees|with the wood axe across her knees}, and nobody in the valley will come near the house tonight. Nobody would dare.
}
* [Say her name out loud.]
  You say it to the empty path. It's the first thing anyone at the gate has said all night.
* [Keep your eyes on the path.]
  She'd tell you to. Eyes front, on the wall and off it.
- The mist comes up from the battlefield and doesn't clear.
-> END

=== gone ===
You think of Thurid, because on a night like this you always stood next to her, and there is nobody on your left.
* [Close up the gap.]
  You move your stool a hand's width to the left. It doesn't help. You leave it there.
* [Leave the gap.]
  You leave it. Somebody should stand there, and nobody else will do.
- The mist comes up from the battlefield and doesn't clear.
-> END
