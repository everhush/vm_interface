import {test} from "node:test";
import assert from "node:assert/strict";
import {migrationViolations} from "../scripts/check-source-migration.ts";
test("reject tracked legacy scripts and build configs",()=>{for(const path of ["scripts/a.py","scripts/__pycache__/a.pyc","Dockerfile","build/Dockerfile.test",".dockerignore","docker-compose.yml"])assert(migrationViolations(path,"").length,path);});
test("reject executable interpreter or daemon references",()=>{for(const value of ["python3 -c 'print(1)'","python3 scripts/test.py","uses: actions/setup-python@v5","sudo docker run hello","/var/run/docker.sock","docker/build-push-action@v6"])assert(migrationViolations("scripts/check.sh",value).length,value);});
test("permit OCI interoperability and historical documentation",()=>{assert.deepEqual(migrationViolations("scripts/build-oci.sh","buildah from docker.io/library/node:24"),[]);assert.deepEqual(migrationViolations("docs/implementation.md","historical Python 3 test count"),[]);});

test("inspect tests and reject indirect executable invocation",()=>{
 for(const value of ["spawn('python3',['-c','pass'])","execFileSync('/usr/bin/python3',args)","spawnSync('docker',['build','.'])","python3 \"$fixture\"","apt-get install -y python3"])assert(migrationViolations("tests/fixture.test.ts",value).length,value);
 assert.deepEqual(migrationViolations("tests/fixture.test.ts","const url='https://docker.io/library/node'"),[]);
});
