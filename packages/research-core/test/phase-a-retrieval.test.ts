import {describe,expect,it} from 'vitest';
import {applySourcePolicy,canonicalSourceUrl,defaultSourcePolicy,mergeSteeringIntoPolicy,sourcePolicyAllows} from '../src/source-policy.js';
import {freshnessPolicyForQuestion,sourcesHaveUnmetFreshness,parseSourcePublicationDate,unresolvedFreshnessLimitation} from '../src/freshness.js';
import {constrainSourcePlan,planSourceClass} from '../src/source-strategy.js';

describe('ENG-015–019 retrieval policy',()=>{
 it('prefers vendor/standards/project primary sources but retains secondary fallback',()=>{
  const policy={...defaultSourcePolicy(),mode:'prefer_primary' as const};
  for(const url of ['https://docs.python.org/3/','https://www.rfc-editor.org/rfc/rfc9110','https://docs.nvidia.com/cuda/','https://developer.apple.com/xcode/']) {
   expect(applySourcePolicy(policy,url,'CUDA python iPhone RFC')).toBe('prefer');
  }
  expect(applySourcePolicy(policy,'https://review.example/test')).toBe('admit');
  expect(applySourcePolicy(policy,'https://nvidia.com.evil.example/docs')).toBe('admit');
  expect(applySourcePolicy(policy,'https://docs.nvidia.com/cuda/','CUDA compatibility')).toBe('prefer');
  expect(applySourcePolicy(policy,'https://docs.nvidia.com/cuda/','French tax law')).toBe('admit');
  expect(constrainSourcePlan(planSourceClass('official minimum wage'),'prefer_primary').fallbacks).toContain('generic-web');
  expect(applySourcePolicy(mergeSteeringIntoPolicy(policy,'Only use official sources'),'https://review.example/test')).toBe('exclude');
  expect(mergeSteeringIntoPolicy(defaultSourcePolicy(),'Prefer official sources').mode).toBe('prefer_primary');
  expect(mergeSteeringIntoPolicy(defaultSourcePolicy(),'Only use official sources').mode).toBe('primary_only');
 });
 it('normalizes only safe URL equivalents and retains semantic query identity',()=>{
  expect(canonicalSourceUrl('https://EXAMPLE.org:443/a?x=1&utm_source=feed#intro')).toBe('https://example.org/a?x=1');
  expect(canonicalSourceUrl('http://example.org:80/a/?fbclid=abc')).toBe('http://example.org/a');
  expect(canonicalSourceUrl('https://example.org/a?version=2&x=1')).not.toBe(canonicalSourceUrl('https://example.org/a?version=1&x=1'));
  expect(canonicalSourceUrl('https://example.org/a?x=1&gclid=1')).toBe(canonicalSourceUrl('https://example.org/a?x=1'));
  expect(()=>canonicalSourceUrl('https://secret@example.org/a')).toThrow('invalid_source_url');
  expect(()=>canonicalSourceUrl('not-a-url')).toThrow('invalid_source_url');
 });
 it('keeps a user URL exception exact and does not transfer it to a redirect destination',()=>{
  const policy=mergeSteeringIntoPolicy(defaultSourcePolicy(),'Only use official sources. https://vendor.example/spec');
  expect(sourcePolicyAllows(policy,'https://vendor.example/spec')).toBe(true);
  expect(sourcePolicyAllows(policy,'https://vendor.example/other')).toBe(false);
  expect(sourcePolicyAllows(policy,'https://excluded.example/page')).toBe(false);
 });
 it('keeps absent/invalid required date and version unmet, never replaces with retrieval date',()=>{
  const now=new Date('2026-09-19T12:00:00Z');
  for(const question of ['current price','applicable law','firmware compatibility']){
   const policy=freshnessPolicyForQuestion(question);
   expect(sourcesHaveUnmetFreshness(policy,[],now)).toBe(true);
   expect(sourcesHaveUnmetFreshness(policy,[{retrievedAt:now}],now)).toBe(true);
   expect(unresolvedFreshnessLimitation(policy).length).toBeGreaterThan(0);
  }
  expect(sourcesHaveUnmetFreshness(freshnessPolicyForQuestion('applicable law'),[{publicationDate:now}],now)).toBe(true);
  expect(sourcesHaveUnmetFreshness(freshnessPolicyForQuestion('applicable law'),[{effectiveDate:now}],now)).toBe(false);
  expect(sourcesHaveUnmetFreshness(freshnessPolicyForQuestion('firmware compatibility'),[{publicationDate:now}],now)).toBe(true);
  expect(sourcesHaveUnmetFreshness(freshnessPolicyForQuestion('firmware compatibility'),[{version:'4.2'}],now)).toBe(false);
  expect(freshnessPolicyForQuestion('What firmware does Ardent require for offline recording?').requiresVersion).toBe(false);
  expect(parseSourcePublicationDate('2026-02-30')).toBeNull();
 });
});
