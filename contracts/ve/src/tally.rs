//! Total lock weight with linear decay, without iterating locks (maths §9).
//!
//! A lock of `A` ending at epoch `end` weighs `A·(end − e) / 104` at epoch `e`. Summed over locks:
//! `(S1 − e·S0) / 104` with `S0 = Σ A` and `S1 = Σ A·end`, over locks still running at `e`. Locks drop out
//! of the sums at their `end` via a schedule of expiries.

use near_sdk::near;
use oneup_math as math;
use std::collections::BTreeMap;

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Tally {
    pub s0: u128,
    pub s1: u128,
    /// end epoch → Σ A that stops counting at that epoch.
    pub expiries: BTreeMap<u64, u128>,
    /// Expiries are applied through this epoch.
    pub processed: u64,
}

/// A lock's weight at epoch `e`.
pub fn power(amount: u128, end: u64, e: u64) -> u128 {
    if end <= e {
        return 0;
    }
    math::ve_power(amount, end - e)
}

impl Tally {
    pub fn add(&mut self, amount: u128, end: u64) {
        assert!(end > self.processed, "lock already expired");
        self.s0 += amount;
        self.s1 += amount * end as u128;
        *self.expiries.entry(end).or_default() += amount;
    }

    pub fn remove(&mut self, amount: u128, end: u64) {
        if end <= self.processed {
            return; // already dropped out
        }
        self.s0 -= amount;
        self.s1 -= amount * end as u128;
        let v = self.expiries.get_mut(&end).expect("expiry");
        *v -= amount;
        if *v == 0 {
            self.expiries.remove(&end);
        }
    }

    /// Drops locks that end at or before `e` and returns the total weight at `e`.
    pub fn checkpoint(&mut self, e: u64) -> u128 {
        let ended: Vec<u64> = self.expiries.range(..=e).map(|(k, _)| *k).collect();
        for end in ended {
            let a = self.expiries.remove(&end).unwrap();
            self.s0 -= a;
            self.s1 -= a * end as u128;
        }
        self.processed = self.processed.max(e);
        (self.s1 - e as u128 * self.s0) / math::VE_MAX_EPOCHS as u128
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oneup_math::ONEUP;
    use proptest::prelude::*;

    #[test]
    fn v7_decay() {
        let mut t = Tally::default();
        // locked in epoch 0 for 104 epochs → counts from epoch 1, ends at 105
        t.add(1_000 * ONEUP, 105);
        assert_eq!(t.checkpoint(1), 1_000 * ONEUP);
        assert_eq!(t.checkpoint(53), 500 * ONEUP);
        assert_eq!(t.checkpoint(105), 0);
        assert!(t.expiries.is_empty() && t.s0 == 0);
    }

    #[test]
    fn remove_takes_a_lock_out_of_future_epochs() {
        let mut t = Tally::default();
        t.add(1_000 * ONEUP, 105);
        t.add(520 * ONEUP, 53);
        assert_eq!(t.checkpoint(1), 1_000 * ONEUP + 260 * ONEUP);
        t.remove(1_000 * ONEUP, 105);
        assert_eq!(t.checkpoint(2), 520 * ONEUP * 51 / 104);
    }

    proptest! {
        /// The O(1) total matches summing every lock's weight directly.
        #[test]
        fn total_matches_direct_sum(locks in prop::collection::vec((1u128..1_000_000, 1u64..=104, 0u64..20), 1..30), e in 0u64..150) {
            let mut t = Tally::default();
            for (amt, n, start) in &locks {
                t.add(amt * ONEUP, start + 1 + n);
            }
            // every lock starts before epoch 20, so compare from there
            let e = e.max(20);
            let direct: u128 = locks.iter().map(|(amt, n, start)| power(amt * ONEUP, start + 1 + n, e)).sum();
            let got = t.checkpoint(e);
            // the tally divides once; the direct sum divides per lock
            prop_assert!(got >= direct && got - direct <= locks.len() as u128, "{} vs {}", got, direct);
        }
    }
}
