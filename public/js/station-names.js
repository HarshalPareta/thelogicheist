window.stationNames = Object.freeze([
  '',
  'The Professor’s Blackboard',
  'The Royal Mint Blueprint',
  'The Rio Firewall',
  'Inspector Murillo’s Tent',
  'The Submerged Vault',
]);

window.stationName = (station) => window.stationNames[Number(station)] || 'Unknown location';
