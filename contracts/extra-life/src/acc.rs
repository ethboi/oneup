//! Pro-rata payout to every unpaid Extra Life in O(1) per epoch and per claim (maths §6).
//!
//! Each epoch pays `pay_j = r × remaining_j` with `r = pot / Σ remaining`, so every life's remaining
//! balance is multiplied by the same `(1 − r)`. We keep the running product `acc`; a life minted at
//! `acc_at_mint` has `remaining = owed × acc_now / acc_at_mint`.
//!
//! `acc` shrinks every epoch, so when it falls below 1e9 it is multiplied by 1e9 and `scale` goes up
//! (Liquity's stability-pool technique). A life two or more scales behind has under 1e-9 of its
//! balance left and counts as fully paid. When everything is paid (`Σ remaining = 0`) a new era starts.
//! Rounding: `acc` and `remaining` round up, so lives are never paid more than the pots received.

use near_sdk::near;
use oneup_math::mul_div_ceil;

pub const ACC_ONE: u128 = 1_000_000_000_000_000_000;
pub const SCALE_STEP: u128 = 1_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub era: u32,
    pub scale: u32,
    pub acc: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Accumulator {
    pub era: u32,
    pub scale: u32,
    pub acc: u128,
    /// Σ remaining over every unpaid life (exact; per-life values round up around it).
    pub total_remaining: u128,
}

impl Default for Accumulator {
    fn default() -> Self {
        Self { era: 0, scale: 0, acc: ACC_ONE, total_remaining: 0 }
    }
}

impl Accumulator {
    pub fn snapshot(&self) -> Snapshot {
        Snapshot { era: self.era, scale: self.scale, acc: self.acc }
    }

    /// A new life owed `owed` joins at the current snapshot.
    pub fn add(&mut self, owed: u128) -> Snapshot {
        self.total_remaining += owed;
        self.snapshot()
    }

    /// Applies an epoch's pot. Returns the amount used (≤ pot); the rest goes back to the sender.
    pub fn apply_pot(&mut self, pot: u128) -> u128 {
        if self.total_remaining == 0 || pot == 0 {
            return 0;
        }
        let used = pot.min(self.total_remaining);
        let left = self.total_remaining - used;
        if left == 0 {
            *self = Accumulator { era: self.era + 1, ..Default::default() };
            return used;
        }
        let mut acc = mul_div_ceil(self.acc, left, self.total_remaining);
        if acc < SCALE_STEP {
            acc *= SCALE_STEP;
            self.scale += 1;
        }
        self.acc = acc;
        self.total_remaining = left;
        used
    }

    pub fn remaining(&self, owed: u128, at: Snapshot) -> u128 {
        if at.era != self.era {
            return 0;
        }
        match self.scale - at.scale {
            0 => mul_div_ceil(owed, self.acc, at.acc),
            1 => mul_div_ceil(owed, self.acc, at.acc * SCALE_STEP),
            _ => 0,
        }
        .min(owed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn v5_pro_rata() {
        // the doc's V5: owed 1_840 / 10_000 / 25_000, pot 18_000
        let mut a = Accumulator::default();
        let s = [a.add(1_840), a.add(10_000), a.add(25_000)];
        assert_eq!(a.apply_pot(18_000), 18_000);
        let paid: Vec<u128> = [1_840u128, 10_000, 25_000].iter().zip(s).map(|(o, s)| o - a.remaining(*o, s)).collect();
        assert_eq!(paid, vec![899, 4_885, 12_214]);
        assert_eq!(a.total_remaining, 36_840 - 18_000);
    }

    #[test]
    fn paid_in_full_starts_a_new_era() {
        let mut a = Accumulator::default();
        let s = a.add(1_000);
        assert_eq!(a.apply_pot(5_000), 1_000);
        assert_eq!(a.remaining(1_000, s), 0);
        assert_eq!(a.era, 1);
        let s2 = a.add(500);
        assert_eq!(a.remaining(500, s2), 500);
    }

    #[test]
    fn late_joiner_only_shares_later_pots() {
        let mut a = Accumulator::default();
        let early = a.add(1_000);
        a.apply_pot(500);
        let late = a.add(1_000);
        a.apply_pot(750); // r = 750 / 1_500 = 0.5
        assert_eq!(a.remaining(1_000, early), 250);
        assert_eq!(a.remaining(1_000, late), 500);
    }

    #[test]
    fn rescales_over_many_epochs() {
        let mut a = Accumulator::default();
        let s = a.add(10u128.pow(15));
        for _ in 0..40 {
            a.add(10u128.pow(15)); // new lives keep joining
            let pot = a.total_remaining * 99 / 100; // r ≈ 0.99 every epoch
            a.apply_pot(pot);
        }
        assert_eq!(a.era, 0);
        assert!(a.scale >= 2);
        let late = a.add(10u128.pow(12));
        a.apply_pot(a.total_remaining / 2);
        assert!(a.remaining(10u128.pow(15), s) <= 1);
        let r = a.remaining(10u128.pow(12), late);
        assert!(r.abs_diff(10u128.pow(12) / 2) <= 10u128.pow(12) / 1_000, "late life {r}");
    }

    proptest! {
        /// Lives are never paid more than the pots received, and never more than they're owed.
        #[test]
        fn never_overpays(steps in prop::collection::vec((0u128..1_000_000_000_000, 0u128..1_000_000_000_000), 1..40)) {
            let mut a = Accumulator::default();
            let mut lives: Vec<(u128, Snapshot)> = vec![];
            let mut received = 0u128;
            for (owed, pot) in steps {
                if owed > 0 { lives.push((owed, a.add(owed))); }
                received += a.apply_pot(pot);
                let paid: u128 = lives.iter().map(|(o, s)| o - a.remaining(*o, *s)).sum();
                prop_assert!(paid <= received + lives.len() as u128, "paid {} received {}", paid, received);
                for (o, s) in &lives { prop_assert!(a.remaining(*o, *s) <= *o); }
            }
        }
    }
}
