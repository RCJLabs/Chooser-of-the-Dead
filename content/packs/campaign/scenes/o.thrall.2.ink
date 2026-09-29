# draft
// FIRST DRAFT (phase 6): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// The freed thrall's choice (docs/tech-spec.md §72): the jarl's steward says Kormak's freedom was never witnessed properly, and wants it paid for again.
EXTERNAL home(id)
{ not home("kormak"): -> gone }
Kormak's bark tonight has two drawings: the jarl's steward, round and pointing, and Kormak with his hands spread wide.
Underneath, someone at home has written it out plainly. The steward says only two witnesses drank at Kormak's freedom-ale, and the law wants three. Fifteen rings buys a third witness, who will remember being there. Otherwise Kormak goes back to the farm at the thaw.
You were at that ale. You paid for half of it. There were eleven people there, and the steward was one of them.
* [Send fifteen rings for a witness. #needs: rings 15]
  # fx: rings -15
  # fx: flag kormak_paid
  You send the rings. The new witness remembers the freedom-ale in great detail, including the ale, which he says was thin.
* [Stamp his freedom yourself.]
  # fx: standing odin -1
  # fx: flag kormak_stamped
  You cut Kormak's name on a tally, and "free" after it, and bring down the stamp you use for the ones who aren't dead yet: RETURN. Sent back to his own life, and nobody's but his.
  The steward, shown a Valkyrie's stamp, finds that the law wants only two witnesses after all. Somewhere, you suspect, it has been noticed what the stamp of the slain was used for.
- Kormak's next drawing is of the steward, very small, running.
-> END

=== gone ===
The jarl's steward writes, in a very small hand, to say that the matter of Kormak's freedom is closed. He doesn't say why. He doesn't need to.
-> END
