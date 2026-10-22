//! Each epoch's pot shared by what each life was originally owed, each capped at what it's still owed (D-25,
//! maths §6).
//!
//! Lives minted together (an epoch's cohort, or the Backer Lives minted between two pots) join at once and are
//! always paid the same fraction of what they're owed, so a group is enough: it keeps its total owed and the
//! fraction `frac` paid so far (1e18 = all of it). A pot raises every earning group's `frac` by the same amount,
//! `pot / Σ owed`; a group that would pass 1 is filled exactly and the rest is shared again (water-filling). A
//! life's paid is `owed × frac`, so a claim is O(1) and a pot is O(groups earning): at most the 14 epoch
//! cohorts plus the bootstrap round's backer groups.
//!
//! Sharing by original owed (rather than by what's still owed) keeps each life earning at a steady rate until
//! it's paid, so a large Backer Life finishes in a straight line instead of slowing to a crawl as newer lives
//! crowd it out.
//!
//! Rounding: paid rounds down per life and per group, and each step is the largest that spends no more than is
//! left (a binary search over a few units' width), so lives are never paid more than the pots received and a
//! pot isn't left with dust.

use near_sdk::near;
use oneup_math::mul_div;

/// `frac` of a group that has been paid in full.
pub const ONE: u128 = 1_000_000_000_000_000_000;

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Group {
    /// Σ owed by the group's lives.
    pub owed: u128,
    /// Fraction of `owed` paid so far, 1e18 = in full.
    pub frac: u128,
    /// Out of its earning window: its lives keep what they earned and earn no more.
    pub expired: bool,
}

impl Group {
    /// What a life owed `owed` in this group has been paid so far.
    pub fn paid(&self, owed: u128) -> u128 {
        mul_div(owed, self.frac.min(ONE), ONE).min(owed)
    }

    /// What the group as a whole has been paid.
    pub fn total_paid(&self) -> u128 {
        self.paid(self.owed)
    }

    pub fn remaining(&self) -> u128 {
        self.owed - self.total_paid()
    }

    pub fn full(&self) -> bool {
        self.frac >= ONE
    }
}

/// Shares `pot` across `groups` (the ones earning) by what each was owed, each capped at what it's still
/// owed. Returns the amount used (≤ pot), which is exactly how much the groups' paid went up.
pub fn share_pot(groups: &mut [Group], pot: u128) -> u128 {
    let mut left = pot;
    let mut open: Vec<usize> = (0..groups.len()).filter(|&i| !groups[i].full() && groups[i].owed > 0).collect();
    while !open.is_empty() && left > 0 {
        let total: u128 = open.iter().map(|&i| groups[i].owed).sum();
        // the largest equal step that spends no more than what's left: paid rounds down per group, so the plain
        // quotient can leave a unit or two unspent, or (after earlier pots' floors) spend one too many
        let mut lo = mul_div(left.saturating_sub(open.len() as u128), ONE, total);
        let mut hi = mul_div(left + open.len() as u128, ONE, total) + 1;
        while lo + 1 < hi {
            let mid = lo + (hi - lo) / 2;
            if raise(groups, &open, mid) <= left {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        let delta = lo;
        let (filling, rest): (Vec<usize>, Vec<usize>) = open.iter().partition(|&&i| ONE - groups[i].frac <= delta);
        if filling.is_empty() {
            if delta == 0 {
                break;
            }
            for i in rest {
                let before = groups[i].total_paid();
                groups[i].frac += delta;
                left -= groups[i].total_paid() - before;
            }
            break;
        }
        for i in filling {
            let before = groups[i].total_paid();
            groups[i].frac = ONE;
            left -= groups[i].total_paid() - before;
        }
        open = rest;
    }
    pot - left
}

/// How much raising `open`'s fractions by `delta` would pay (each capped at what it's still owed).
fn raise(groups: &[Group], open: &[usize], delta: u128) -> u128 {
    open.iter()
        .map(|&i| {
            let g = &groups[i];
            Group { frac: (g.frac + delta).min(ONE), ..g.clone() }.total_paid() - g.total_paid()
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn group(owed: u128) -> Group {
        Group { owed, ..Default::default() }
    }

    #[test]
    fn v5_pot_shared_by_owed() {
        // the doc's V5: owed 1_840 / 10_000 / 25_000, pot 18_000
        let mut g = [group(1_840 * 1_000_000), group(10_000 * 1_000_000), group(25_000 * 1_000_000)];
        let used = share_pot(&mut g, 18_000 * 1_000_000);
        let paid: Vec<u128> = g.iter().map(|x| x.total_paid() / 1_000_000).collect();
        assert_eq!(paid, vec![899, 4_885, 12_214]);
        assert!(used <= 18_000 * 1_000_000 && used > 18_000 * 1_000_000 - 10);
    }

    #[test]
    fn a_half_paid_life_keeps_its_full_share() {
        // the old rule (share by what's left) would give the half-paid one a third of the next pot; this one a half
        let mut g = [group(1_000), group(1_000)];
        g[0].frac = ONE / 2;
        share_pot(&mut g, 400);
        assert_eq!((g[0].total_paid(), g[1].total_paid()), (500 + 200, 200));
    }

    #[test]
    fn a_group_that_fills_passes_the_rest_on() {
        let mut g = [group(1_000), group(10_000)];
        g[0].frac = ONE * 9 / 10; // 100 left
        let used = share_pot(&mut g, 2_000);
        assert!(g[0].full());
        assert_eq!(g[0].total_paid(), 1_000);
        // 100 to fill the first, the other 1_900 to the second
        assert_eq!(g[1].total_paid(), 1_900);
        assert_eq!(used, 100 + g[1].total_paid());
    }

    #[test]
    fn more_than_owed_returns_the_rest() {
        let mut g = [group(1_000), group(500)];
        assert_eq!(share_pot(&mut g, 10_000), 1_500);
        assert!(g.iter().all(Group::full));
    }

    #[test]
    fn lives_in_a_group_are_paid_the_same_fraction() {
        let mut g = [Group { owed: 3_000, ..Default::default() }];
        share_pot(&mut g, 1_500);
        assert_eq!((g[0].paid(1_000), g[0].paid(2_000)), (500, 1_000));
    }

    proptest! {
        /// Groups are never paid more than the pots received, never more than they're owed, and the lives in a
        /// group never more than the group.
        #[test]
        fn never_overpays(
            owed in prop::collection::vec(1u128..10_000_000_000_000, 1..16),
            pots in prop::collection::vec(0u128..5_000_000_000_000, 1..30),
            split in 1u128..1_000,
        ) {
            let mut g: Vec<Group> = owed.iter().map(|&o| group(o)).collect();
            let mut received = 0u128;
            for pot in pots {
                received += share_pot(&mut g, pot);
                let paid: u128 = g.iter().map(Group::total_paid).sum();
                prop_assert_eq!(paid, received);
                for x in &g {
                    prop_assert!(x.total_paid() <= x.owed);
                    // two lives splitting the group: never more than the group together
                    let a = x.owed * split / 1_000;
                    prop_assert!(x.paid(a) + x.paid(x.owed - a) <= x.total_paid());
                }
            }
        }

        /// Every earning group moves by the same fraction of what it was owed, until it fills.
        #[test]
        fn equal_fractions(owed in prop::collection::vec(1_000_000u128..10_000_000_000_000, 2..10), pot in 1_000_000u128..1_000_000_000_000) {
            let mut g: Vec<Group> = owed.iter().map(|&o| group(o)).collect();
            share_pot(&mut g, pot);
            let open: Vec<&Group> = g.iter().filter(|x| !x.full()).collect();
            for w in open.windows(2) { prop_assert_eq!(w[0].frac, w[1].frac); }
        }
    }
}
