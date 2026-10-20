import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import assert from 'node:assert/strict';

const docs = readdirSync('k8s').filter(name => name.endsWith('.yaml')).map(name => parse(readFileSync(`k8s/${name}`, 'utf8')));
for (const doc of docs) {
  assert.ok(doc.apiVersion && doc.kind && doc.metadata?.name);
  if (doc.kind !== 'Namespace') assert.equal(doc.metadata.namespace, 'ecommerce');
}
for (const kind of ['Namespace', 'Deployment', 'Service', 'PersistentVolumeClaim', 'ConfigMap']) assert.ok(docs.some(d => d.kind === kind));
const deployment = docs.find(d => d.kind === 'Deployment');
assert.equal(deployment.spec.replicas, 1);
assert.equal(deployment.spec.strategy.type, 'Recreate');
const container = deployment.spec.template.spec.containers[0];
assert.ok(container.image.endsWith(':2.0.0'));
assert.equal(container.livenessProbe.httpGet.path, '/health/live');
assert.equal(container.readinessProbe.httpGet.path, '/health/ready');
assert.equal(container.ports[0].containerPort, 3000);
assert.ok(container.envFrom.some(e => e.secretRef?.name === 'notificaciones-secret'));
console.log('Manifiestos YAML válidos; Deployment, Service, PVC, ConfigMap y referencias de Secret comprobados.');
