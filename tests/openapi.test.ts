import {test} from "node:test";
import assert from "node:assert/strict";
import {openApiDocument} from "../src/openapi";
import {schema} from "../src/spec";

test("published contract covers all implemented endpoints and matches the live schema",()=>{
 const doc=openApiDocument();
 assert.equal(doc.openapi,"3.1.0");
 assert.equal(doc.servers[0].url,"/api/v1");
 const expected=["/health","/account","/audit","/account/quota","/keys","/keys/{keyId}","/keys/{keyId}/rotate","/schema","/schema/advanced","/images","/capabilities","/openapi.json","/computers/plan","/computers","/computers/{id}","/computers/{id}/storage","/computers/{id}/storage/plan","/computers/{id}/disks","/computers/{id}/disks/plan","/computers/{id}/exchange-bundle","/computers/{id}/disk-exports/{name}","/computers/{id}/disk-exports/{name}/file","/computers/{id}/exposures","/computers/{id}/exposures/{grantId}","/computers/{id}/exposures/{grantId}/connect","/computers/{id}/media","/computers/{id}/media/{slot}","/computers/{id}/media/{slot}/chunks","/computers/{id}/media/{slot}/commit","/computers/{id}/files","/computers/{id}/files/{name}","/computers/{id}/guest","/computers/{id}/screenshot","/computers/{id}/vnc","/computers/{id}/input-lease","/computers/{id}/input","/computers/{id}/recordings","/computers/{id}/recordings/{recordingId}","/computers/{id}/recordings/{recordingId}/stop","/computers/{id}/recordings/{recordingId}/file","/computers/{id}/console-tickets","/computers/{id}/console-tickets/{ticketId}","/computers/{id}/boot","/computers/{id}/boot/plan","/computers/{id}/hardware","/computers/{id}/hardware/plan","/computers/{id}/start","/computers/{id}/stop","/computers/{id}/restart","/computers/{id}/reset","/operations","/operations/{id}"];
 assert.deepEqual(Object.keys(doc.paths).sort(),expected.sort());
 const {$schema:ignored,...shape}=schema;
 assert.ok(ignored);
 assert.deepEqual(doc.components.schemas.ComputerSpec,shape);
 assert.ok(doc.paths["/computers/{id}/guest"]);
 assert.ok(doc.components.schemas.GuestObservation);
 assert.deepEqual(doc.paths["/health"].get.security,[]);
 assert.deepEqual(doc.security,[{TestBearer:[]}]);
 for(const op of [doc.paths["/computers"].post,doc.paths["/computers/{id}"].delete,doc.paths["/computers/{id}/boot"].patch,doc.paths["/computers/{id}/hardware"].patch,doc.paths["/computers/{id}/storage"].patch,doc.paths["/computers/{id}/disks"].post,doc.paths["/computers/{id}/start"].post,doc.paths["/computers/{id}/stop"].post,doc.paths["/computers/{id}/restart"].post,doc.paths["/computers/{id}/reset"].post]){
  assert.ok(op.parameters.some(p=>typeof p==="object"&&p!==null&&"name" in p&&p.name==="Idempotency-Key"));
  assert.ok(op.responses["202"]);
 }
});
