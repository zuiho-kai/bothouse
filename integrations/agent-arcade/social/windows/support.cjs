'use strict';

const assert = require('node:assert/strict');
const { BlockList, isIP } = require('node:net');
const { privacyContact } = require('../server/config.cjs');
const { isIanaExampleDomain, isLocalDnsName } = require('./endpoint.cjs');

const nonPublicSupport = new BlockList();
for(const [network,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.2.0',24],['192.168.0.0',16],['198.51.100.0',24],
  ['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])
  nonPublicSupport.addSubnet(network,prefix,'ipv4');
for(const [network,prefix] of [['::',128],['::1',128],['2001:db8::',32],['3fff::',20],
  ['fc00::',7],['fe80::',10],['ff00::',8]])
  nonPublicSupport.addSubnet(network,prefix,'ipv6');

function hasPublicSupportHost(href) {
  const url=href.startsWith('mailto:')?URL.parse('https://'+href.slice(href.lastIndexOf('@')+1)):new URL(href);
  if(!url)return false;
  const host=url.hostname.replace(/^\[|\]$|\.$/gu,'');
  const version=isIP(host);
  if(version)return !nonPublicSupport.check(host,version===6?'ipv6':'ipv4');
  return host.includes('.')&&!isIanaExampleDomain(host)&&!isLocalDnsName(host);
}

const privacySupportError = 'Support URL resolves to the service privacy page. Use a separate support page or support email.';

function releaseContact({mode,origin,operatorName,support}) {
  const contact=privacyContact({
    SOCIAL_PUBLIC_OPERATOR_NAME:operatorName,SOCIAL_PUBLIC_PRIVACY_CONTACT:support,
  });
  assert(contact,'Supply the public operator name and support contact.');
  if(mode==='store')assert(hasPublicSupportHost(contact.href),
    'Store support must use a public email or HTTPS address, outside reserved, example, local/private or multicast hosts.');
  const url=new URL(contact.href);
  assert(url.origin!==origin||url.pathname!=='/privacy.html',privacySupportError);
  return contact;
}

function verifyOfflineSupport(embedded, contact, hasSupportBridge, { historical=false }={}) {
  if(embedded.mode!=='store'){
    assert.equal(embedded.offlineSupport,undefined,'Packaging tests use the distributor support hint.');
    return hasSupportBridge?'test-distributor-hint':'legacy-no-offline-contact';
  }
  if(!hasSupportBridge&&embedded.offlineSupport===undefined){
    assert(historical,'Store submission requires offline support in the MSIX. Use --historical only to recheck a historical desktop and service pairing.');
    return 'legacy-no-offline-contact';
  }
  assert(hasSupportBridge,'Offline support is present without its desktop bridge.');
  assert.deepEqual(embedded.offlineSupport,contact,'MSIX offline support differs from the submitted operator and support contact.');
  return 'matches-release-contact';
}

module.exports={releaseContact,verifyOfflineSupport,privacySupportError};
