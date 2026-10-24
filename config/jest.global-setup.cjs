/**
 * Render dates in one time zone so English rendering snapshots match on every
 * machine and in CI. Jest workers inherit this environment from the parent.
 */
module.exports = () => {
  process.env.TZ = "UTC";
};
