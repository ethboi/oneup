//! Per-market vote totals with linear decay, without iterating locks (maths §9).
//!
//! A lock of `A` voting `a` ppm for market `m` until epoch `end` has power `A·a·(end − e) / (52·PPM)` at
//! epoch `e`. Summed over locks: `(S1 − e·S0) / (52·PPM)` with `S0 = Σ A·a` and `S1 = Σ A·a·end`, over locks
//! still active at `e`. Locks drop out of the sums at their `end` via a schedule of expiries.

use near_sdk::near;
use oneup_math as math;
use std::collections::BTreeMap;

pub type Alloc = Vec<(String, u128)>;

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Sums {
    pub s0: u128,
    pub s1: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Tally {
    pub sums: BTreeMap<String, Sums>,
    /// end epoch → market → Σ A·a that stops counting at that epoch.
    pub expiries: BTreeMap<u64, BTreeMap<String, u128>>,
    /// Expiries are applied through this epoch.
    pub processed: u64,
}

/// A lock's power for one market at epoch `e`.
pub fn power(amount: u128, alloc_ppm: u128, end: u64, e: u64) -> u128 {
    if end <= e {
        return 0;
    }
    amount * alloc_ppm * (end - e) as u128 / (math::VE_MAX_EPOCHS as u128 * math::PPM)
}

impl Tally {
    pub fn add(&mut self, amount: u128, end: u64, alloc: &Alloc) {
        assert!(end > self.processed, "lock already expired");
        for (m, a) in alloc {
            let part = amount * a;
            let s = self.sums.entry(m.clone()).or_default();
            s.s0 += part;
            s.s1 += part * end as u128;
            *self.expiries.entry(end).or_default().entry(m.clone()).or_default() += part;
        }
    }

    pub fn remove(&mut self, amount: u128, end: u64, alloc: &Alloc) {
        if end <= self.processed {
            return; // already dropped out
        }
        for (m, a) in alloc {
            let part = amount * a;
            let s = self.sums.get_mut(m).expect("market sums");
            s.s0 -= part;
            s.s1 -= part * end as u128;
            let ex = self.expiries.get_mut(&end).expect("expiry");
            let v = ex.get_mut(m).expect("expiry market");
            *v -= part;
            if *v == 0 {
                ex.remove(m);
            }
            if ex.is_empty() {
                self.expiries.remove(&end);
            }
        }
    }

    /// Drops locks that end at or before `e` and returns each market's votes at `e` (zero totals left out).
    pub fn checkpoint(&mut self, e: u64) -> Vec<(String, u128)> {
        let ended: Vec<u64> = self.expiries.range(..=e).map(|(k, _)| *k).collect();
        for end in ended {
            for (m, part) in self.expiries.remove(&end).unwrap() {
                let s = self.sums.get_mut(&m).expect("market sums");
                s.s0 -= part;
                s.s1 -= part * end as u128;
            }
        }
        self.processed = self.processed.max(e);
        self.sums.retain(|_, s| s.s0 > 0);
        self.sums
            .iter()
            .map(|(m, s)| (m.clone(), (s.s1 - e as u128 * s.s0) / (math::VE_MAX_EPOCHS as u128 * math::PPM)))
            .filter(|(_, v)| *v > 0)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oneup_math::{ONEUP, PPM};
    use proptest::prelude::*;

    fn alloc(v: &[(&str, u128)]) -> Alloc {
        v.iter().map(|(m, a)| (m.to_string(), *a)).collect()
    }

    #[test]
    fn v7_decay() {
        let mut t = Tally::default();
        // locked in epoch 0 for 52 epochs → counts from epoch 1, ends at 53
        t.add(1_000 * ONEUP, 53, &alloc(&[("NEAR", PPM)]));
        assert_eq!(t.checkpoint(1), vec![("NEAR".into(), 1_000 * ONEUP)]);
        assert_eq!(t.checkpoint(27), vec![("NEAR".into(), 500 * ONEUP)]);
        assert!(t.checkpoint(53).is_empty());
        assert!(t.sums.is_empty() && t.expiries.is_empty());
    }

    #[test]
    fn split_and_change() {
        let mut t = Tally::default();
        let a = alloc(&[("NEAR", 600_000), ("BTC", 400_000)]);
        t.add(1_300 * ONEUP, 14, &a); // 13 epochs from epoch 1 → 325 power at epoch 1
        let v = t.checkpoint(1);
        assert_eq!(v, vec![("BTC".into(), 130 * ONEUP), ("NEAR".into(), 195 * ONEUP)]);
        t.remove(1_300 * ONEUP, 14, &a);
        t.add(1_300 * ONEUP, 14, &alloc(&[("BTC", PPM)]));
        assert_eq!(t.checkpoint(2), vec![("BTC".into(), 1_300 * ONEUP * 12 / 52)]);
    }

    proptest! {
        /// The O(1) totals match summing every lock's power directly.
        #[test]
        fn totals_match_direct_sum(locks in prop::collection::vec((1u128..1_000_000, 1u64..=52, 0usize..3, 0u64..20), 1..30), e in 0u64..80) {
            let markets = ["A", "B", "C"];
            let mut t = Tally::default();
            for (amt, n, m, start) in &locks {
                t.add(amt * ONEUP, start + 1 + n, &alloc(&[(markets[*m], PPM)]));
            }
            // every lock starts before epoch 20, so compare from there
            let e = e.max(20);
            let mut direct = [0u128; 3];
            for (amt, n, m, start) in &locks {
                let end = start + 1 + n;
                direct[*m] += power(amt * ONEUP, PPM, end, e);
            }
            let got = t.checkpoint(e);
            for (i, m) in markets.iter().enumerate() {
                let v = got.iter().find(|(k, _)| k == m).map(|(_, v)| *v).unwrap_or(0);
                // the tally divides once; the direct sum divides per lock
                prop_assert!(v >= direct[i] && v - direct[i] <= locks.len() as u128, "{} vs {}", v, direct[i]);
            }
        }
    }
}
