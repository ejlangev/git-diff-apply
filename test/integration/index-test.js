'use strict';

const { describe, it } = require('../helpers/mocha');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs-extra');
const sinon = require('sinon');
const fixturify = require('fixturify');
const {
  commit,
  buildTmp,
  processExit,
  fixtureCompare: _fixtureCompare
} = require('git-fixtures');
const gitDiffApply = require('../../src');
const utils = require('../../src/utils');
const { isGitClean } = gitDiffApply;
const getCheckedOutBranchName = require('../../src/get-checked-out-branch-name');
const { promisify } = require('util');
const tmpDir = promisify(require('tmp').dir);

describe(function() {
  this.timeout(30000);

  let cwd;
  let sandbox;
  let rootDir;
  let localDir;
  let remoteDir;

  before(function() {
    cwd = process.cwd();
  });

  beforeEach(function() {
    sandbox = sinon.createSandbox();
  });

  afterEach(function() {
    process.chdir(cwd);

    sandbox.restore();
  });

  async function merge({
    localFixtures,
    remoteFixtures,
    remoteUrl,
    dirty,
    noGit,
    subDir = '',
    ignoredFiles = [],
    startTag = 'v1',
    endTag = 'v3',
    reset,
    createCustomDiff,
    startCommand,
    endCommand,
    beforeMerge = async() => {}
  }) {
    localDir = await buildTmp({
      fixturesPath: localFixtures,
      dirty,
      noGit,
      subDir
    });
    remoteDir = await buildTmp({
      fixturesPath: remoteFixtures
    });

    rootDir = path.resolve(localDir, ...subDir.split('/').filter(Boolean).map(() => '..'));

    await beforeMerge();

    process.chdir(localDir);

    // this prefixes /private in OSX...
    // let's us do === against it later
    localDir = process.cwd();

    let promise = gitDiffApply({
      remoteUrl: remoteUrl || remoteDir,
      startTag,
      endTag,
      ignoredFiles,
      reset,
      createCustomDiff,
      startCommand,
      endCommand
    });

    return await processExit({
      promise,
      cwd: localDir,
      commitMessage: 'local',
      noGit,
      expect
    });
  }

  let fixtureCompare = async function fixtureCompare({
    mergeFixtures,
    subDir = '',
    beforeCompare = async() => {}
  }) {
    let localMergeDir = await tmpDir();

    let rootMergeDir = localMergeDir;
    localMergeDir = path.join(rootMergeDir, subDir);
    await fs.ensureDir(localMergeDir);

    await fs.copy(path.join(cwd, mergeFixtures), localMergeDir);

    await beforeCompare({
      localMergeDir,
      rootMergeDir
    });

    _fixtureCompare({
      expect,
      actual: rootDir,
      expected: rootMergeDir
    });
  };

  it('handles no conflicts', async function() {
    let {
      status
    } = await merge({
      localFixtures: 'test/fixtures/local/noconflict',
      remoteFixtures: 'test/fixtures/remote/noconflict'
    });

    await fixtureCompare({
      mergeFixtures: 'test/fixtures/merge/noconflict'
    });

    expect(status).to.equal(`M  changed.txt
`);
  });

  it('handles dirty', async function() {
    let {
      status,
      stderr
    } = await merge({
      localFixtures: 'test/fixtures/local/conflict',
      remoteFixtures: 'test/fixtures/remote/conflict',
      dirty: true
    });

    expect(status).to.equal(`?? a-random-new-file
`);

    expect(stderr).to.contain('You must start with a clean working directory');
    expect(stderr).to.not.contain('UnhandledPromiseRejectionWarning');
  });

  it('doesn\'t resolve conflicts by default', async function() {
    let {
      status
    } = await merge({
      localFixtures: 'test/fixtures/local/conflict',
      remoteFixtures: 'test/fixtures/remote/conflict'
    });

    let actual = await fs.readFile(path.join(localDir, 'present-changed.txt'), 'utf8');

    expect(actual).to.contain('<<<<<<< HEAD');

    expect(status).to.equal(`A  added-changed.txt
A  added-unchanged.txt
DU missing-changed.txt
AA present-added-changed.txt
UU present-changed.txt
UD removed-changed.txt
D  removed-unchanged.txt
`);
  });

  it('ignores files', async function() {
    let {
      status,
      result
    } = await merge({
      localFixtures: 'test/fixtures/local/ignored',
      remoteFixtures: 'test/fixtures/remote/ignored',
      ignoredFiles: ['ignored-changed.txt']
    });

    await fixtureCompare({
      mergeFixtures: 'test/fixtures/merge/ignored'
    });

    expect(status).to.equal(`M  changed.txt
`);

    expect(result).to.deep.equal(
      fixturify.readSync(path.join(cwd, 'test/fixtures/ignored'))
    );
  });

  it('doesn\'t error if no changes', async function() {
    await merge({
      localFixtures: 'test/fixtures/local/nochange',
      remoteFixtures: 'test/fixtures/remote/nochange',
      ignoredFiles: ['changed.txt']
    });

    await fixtureCompare({
      mergeFixtures: 'test/fixtures/merge/nochange'
    });

    expect(await isGitClean({ cwd: localDir })).to.be.ok;
    expect(process.cwd()).to.equal(localDir);
  });

  it('does nothing when tags match', async function() {
    let {
      stderr
    } = await merge({
      localFixtures: 'test/fixtures/local/noconflict',
      remoteFixtures: 'test/fixtures/remote/noconflict',
      startTag: 'v3',
      endTag: 'v3'
    });

    expect(await isGitClean({ cwd: localDir })).to.be.ok;
    expect(process.cwd()).to.equal(localDir);

    expect(stderr).to.contain('Tags match, nothing to apply');
    expect(stderr).to.not.contain('UnhandledPromiseRejectionWarning');
  });

  it('does nothing when not a git repo', async function() {
    let {
      stderr
    } = await merge({
      localFixtures: 'test/fixtures/local/noconflict',
      remoteFixtures: 'test/fixtures/remote/noconflict',
      noGit: true
    });

    expect(process.cwd()).to.equal(localDir);

    expect(stderr).to.contain('Not a git repository');
    expect(stderr).to.not.contain('UnhandledPromiseRejectionWarning');
  });

  it('does not error when no changes between tags', async function() {
    let {
      stderr
    } = await merge({
      localFixtures: 'test/fixtures/local/no-change-between-tags',
      remoteFixtures: 'test/fixtures/remote/no-change-between-tags'
    });

    expect(await isGitClean({ cwd: localDir })).to.be.ok;
    expect(process.cwd()).to.equal(localDir);

    await fixtureCompare({
      mergeFixtures: 'test/fixtures/merge/no-change-between-tags'
    });

    expect(stderr).to.be.undefined;
  });

  describe('sub dir', function() {
    let subDir = 'foo/bar';

    it('scopes to sub dir if run from there', async function() {
      let {
        status
      } = await merge({
        localFixtures: 'test/fixtures/local/noconflict',
        remoteFixtures: 'test/fixtures/remote/noconflict',
        subDir
      });

      await fixtureCompare({
        mergeFixtures: 'test/fixtures/merge/noconflict',
        subDir
      });

      expect(status).to.equal(`M  foo/bar/changed.txt
`);
    });

    it('handles sub dir with ignored files', async function() {
      let {
        status,
        result
      } = await merge({
        localFixtures: 'test/fixtures/local/ignored',
        remoteFixtures: 'test/fixtures/remote/ignored',
        subDir,
        ignoredFiles: ['ignored-changed.txt']
      });

      await fixtureCompare({
        mergeFixtures: 'test/fixtures/merge/ignored',
        subDir
      });

      expect(status).to.equal(`M  foo/bar/changed.txt
`);

      expect(result).to.deep.equal(
        fixturify.readSync(path.join(cwd, 'test/fixtures/ignored'))
      );
    });

    it('preserves locally gitignored', async function() {
      await merge({
        localFixtures: 'test/fixtures/local/noconflict',
        remoteFixtures: 'test/fixtures/remote/noconflict',
        subDir,
        async beforeMerge() {
          await Promise.all([
            fs.ensureFile(path.join(localDir, 'local-and-remote')),
            fs.ensureFile(path.join(localDir, 'local-only')),
            fs.ensureFile(path.join(localDir, 'folder/local-and-remote')),
            fs.ensureFile(path.join(localDir, 'folder/local-only')),
            fs.copy(
              path.join(cwd, 'test/fixtures/local/gitignored/local/.gitignore'),
              path.join(rootDir, '.gitignore')
            )
          ]);

          await commit({ m: 'local', cwd: rootDir });
        }
      });

      await fixtureCompare({
        mergeFixtures: 'test/fixtures/merge/noconflict',
        subDir,
        async beforeCompare({
          localMergeDir,
          rootMergeDir
        }) {
          await Promise.all([
            fs.ensureFile(path.join(localMergeDir, 'local-and-remote')),
            fs.ensureFile(path.join(localMergeDir, 'local-only')),
            fs.ensureFile(path.join(localMergeDir, 'folder/local-and-remote')),
            fs.ensureFile(path.join(localMergeDir, 'folder/local-only')),
            fs.copy(
              path.join(cwd, 'test/fixtures/local/gitignored/local/.gitignore'),
              path.join(rootMergeDir, '.gitignore')
            )
          ]);
        }
      });
    });

    it('resets files to new version + preserves locally gitignored', async function() {
      await merge({
        localFixtures: 'test/fixtures/local/noconflict',
        remoteFixtures: 'test/fixtures/remote/noconflict',
        reset: true,
        subDir,
        async beforeMerge() {
          await Promise.all([
            fs.ensureFile(path.join(localDir, 'local-and-remote')),
            fs.ensureFile(path.join(localDir, 'local-only')),
            fs.ensureFile(path.join(localDir, 'folder/local-and-remote')),
            fs.ensureFile(path.join(localDir, 'folder/local-only')),
            fs.copy(
              path.join(cwd, 'test/fixtures/local/gitignored/local/.gitignore'),
              path.join(rootDir, '.gitignore')
            )
          ]);

          await commit({ m: 'local', cwd: rootDir });
        }
      });

      await fixtureCompare({
        mergeFixtures: 'test/fixtures/remote/noconflict/v3',
        subDir,
        async beforeCompare({
          localMergeDir
        }) {
          await Promise.all([
            fs.ensureFile(path.join(localMergeDir, 'local-and-remote')),
            fs.ensureFile(path.join(localMergeDir, 'local-only')),
            fs.ensureFile(path.join(localMergeDir, 'folder/local-and-remote')),
            fs.ensureFile(path.join(localMergeDir, 'folder/local-only'))
          ]);
        }
      });
    });
  });

  describe('error recovery', function() {
    it('deletes temporary branch when error', async function() {
      let { copy } = utils;
      sandbox.stub(utils, 'copy').callsFake(async function() {
        if (arguments[1] !== localDir) {
          return await copy.apply(this, arguments);
        }

        expect(await isGitClean({ cwd: localDir })).to.be.ok;
        expect(await getCheckedOutBranchName({ cwd: localDir })).to.not.equal('foo');

        throw 'test copy failed';
      });

      let {
        stderr
      } = await merge({
        localFixtures: 'test/fixtures/local/noconflict',
        remoteFixtures: 'test/fixtures/remote/noconflict'
      });

      expect(await isGitClean({ cwd: localDir })).to.be.ok;
      expect(await getCheckedOutBranchName({ cwd: localDir })).to.equal('foo');
      expect(process.cwd()).to.equal(localDir);

      expect(stderr).to.contain('test copy failed');
    });

    it('reverts temporary files after copy when error', async function() {
      let { copy } = utils;
      sandbox.stub(utils, 'copy').callsFake(async function() {
        await copy.apply(this, arguments);

        if (arguments[1] !== localDir) {
          return;
        }

        expect(await isGitClean({ cwd: localDir })).to.not.be.ok;
        expect(await getCheckedOutBranchName({ cwd: localDir })).to.not.equal('foo');

        throw 'test copy failed';
      });

      let {
        stderr
      } = await merge({
        localFixtures: 'test/fixtures/local/noconflict',
        remoteFixtures: 'test/fixtures/remote/noconflict'
      });

      expect(await isGitClean({ cwd: localDir })).to.be.ok;
      expect(await getCheckedOutBranchName({ cwd: localDir })).to.equal('foo');
      expect(process.cwd()).to.equal(localDir);

      expect(stderr).to.contain('test copy failed');
    });

    it('reverts temporary files after apply when error', async function() {
      let { run } = utils;
      sandbox.stub(utils, 'run').callsFake(async function(command) {
        let result = await run.apply(this, arguments);

        if (command.indexOf('git apply') > -1) {
          expect(await isGitClean({ cwd: localDir })).to.not.be.ok;
          expect(await getCheckedOutBranchName({ cwd: localDir })).to.not.equal('foo');

          throw 'test apply failed';
        }

        return result;
      });

      let {
        stderr
      } = await merge({
        localFixtures: 'test/fixtures/local/noconflict',
        remoteFixtures: 'test/fixtures/remote/noconflict'
      });

      expect(await isGitClean({ cwd: localDir })).to.be.ok;
      expect(await getCheckedOutBranchName({ cwd: localDir })).to.equal('foo');
      expect(process.cwd()).to.equal(localDir);

      expect(stderr).to.contain('test apply failed');
    });

    it('preserves cwd when erroring during the orphan step', async function() {
      let { run } = utils;
      sandbox.stub(utils, 'run').callsFake(async function(command) {
        if (command.indexOf('git checkout --orphan') > -1) {
          throw 'test orphan failed';
        }

        return await run.apply(this, arguments);
      });

      let {
        stderr
      } = await merge({
        localFixtures: 'test/fixtures/local/noconflict',
        remoteFixtures: 'test/fixtures/remote/noconflict'
      });

      expect(await isGitClean({ cwd: localDir })).to.be.ok;
      expect(await getCheckedOutBranchName({ cwd: localDir })).to.equal('foo');
      expect(process.cwd()).to.equal(localDir);

      expect(stderr).to.contain('test orphan failed');
    });
  });

  describe('reset', function() {
    it('resets files to new version', async function() {
      let {
        status
      } = await merge({
        localFixtures: 'test/fixtures/local/reset',
        remoteFixtures: 'test/fixtures/remote/reset',
        reset: true,
        ignoredFiles: ['ignored-changed.txt']
      });

      await fixtureCompare({
        mergeFixtures: 'test/fixtures/merge/reset'
      });

      expect(status).to.equal(` M changed.txt
`);
    });

    it('resets using a create diff', async function() {
      let cpr = path.resolve(path.dirname(require.resolve('cpr')), '../bin/cpr');
      let remoteFixtures = 'test/fixtures/remote/reset';
      let startTag = 'v1';
      let endTag = 'v3';

      let {
        status
      } = await merge({
        localFixtures: 'test/fixtures/local/reset',
        remoteFixtures,
        reset: true,
        ignoredFiles: ['ignored-changed.txt'],
        remoteUrl: null,
        createCustomDiff: true,
        startCommand: `node ${cpr} ${path.resolve(remoteFixtures, startTag)} .`,
        endCommand: `node ${cpr} ${path.resolve(remoteFixtures, endTag)} .`,
        startTag,
        endTag
      });

      await fixtureCompare({
        mergeFixtures: 'test/fixtures/merge/reset'
      });

      expect(status).to.equal(` M changed.txt
`);
    });

    it('ignores matching tags', async function() {
      await merge({
        localFixtures: 'test/fixtures/local/reset',
        remoteFixtures: 'test/fixtures/remote/reset',
        reset: true,
        ignoredFiles: ['ignored-changed.txt'],
        startTag: 'v3'
      });

      await fixtureCompare({
        mergeFixtures: 'test/fixtures/merge/reset'
      });
    });

    it('reverts files after remove when error', async function() {
      sandbox.stub(utils, 'gitRemoveAll').callsFake(async() => {
        throw 'test remove failed';
      });

      let {
        stderr
      } = await merge({
        localFixtures: 'test/fixtures/local/reset',
        remoteFixtures: 'test/fixtures/remote/reset',
        reset: true
      });

      expect(await isGitClean({ cwd: localDir })).to.be.ok;
      expect(await getCheckedOutBranchName({ cwd: localDir })).to.equal('foo');
      expect(process.cwd()).to.equal(localDir);

      expect(stderr).to.contain('test remove failed');
    });

    it('reverts files after copy when error', async function() {
      let { copy } = utils;
      sandbox.stub(utils, 'copy').callsFake(async function() {
        await copy.apply(this, arguments);

        if (arguments[1] !== localDir) {
          return;
        }

        expect(await isGitClean({ cwd: localDir })).to.not.be.ok;
        expect(await getCheckedOutBranchName({ cwd: localDir })).to.equal('foo');

        throw 'test copy failed';
      });

      let {
        stderr
      } = await merge({
        localFixtures: 'test/fixtures/local/reset',
        remoteFixtures: 'test/fixtures/remote/reset',
        reset: true
      });

      expect(await isGitClean({ cwd: localDir })).to.be.ok;
      expect(await getCheckedOutBranchName({ cwd: localDir })).to.equal('foo');
      expect(process.cwd()).to.equal(localDir);

      expect(stderr).to.contain('test copy failed');
    });

    it('reverts files after reset when error', async function() {
      let { run } = utils;
      sandbox.stub(utils, 'run').callsFake(async function(command) {
        if (command === 'git reset') {
          throw 'test reset failed';
        }

        return await run.apply(this, arguments);
      });

      let {
        stderr
      } = await merge({
        localFixtures: 'test/fixtures/local/reset',
        remoteFixtures: 'test/fixtures/remote/reset',
        reset: true
      });

      expect(await isGitClean({ cwd: localDir })).to.be.ok;
      expect(await getCheckedOutBranchName({ cwd: localDir })).to.equal('foo');
      expect(process.cwd()).to.equal(localDir);

      expect(stderr).to.contain('test reset failed');
    });

    it('preserves locally gitignored', async function() {
      await merge({
        localFixtures: 'test/fixtures/local/gitignored',
        remoteFixtures: 'test/fixtures/remote/gitignored',
        reset: true,
        async beforeMerge() {
          await Promise.all([
            fs.ensureFile(path.join(localDir, 'local-and-remote')),
            fs.ensureFile(path.join(localDir, 'local-only')),
            fs.ensureFile(path.join(localDir, 'folder/local-and-remote')),
            fs.ensureFile(path.join(localDir, 'folder/local-only'))
          ]);
        }
      });

      await fixtureCompare({
        mergeFixtures: 'test/fixtures/remote/gitignored/v3',
        async beforeCompare({
          localMergeDir
        }) {
          await Promise.all([
            fs.ensureFile(path.join(localMergeDir, 'local-and-remote')),
            fs.ensureFile(path.join(localMergeDir, 'local-only')),
            fs.ensureFile(path.join(localMergeDir, 'folder/local-and-remote')),
            fs.ensureFile(path.join(localMergeDir, 'folder/local-only'))
          ]);
        }
      });
    });
  });

  it('can create a custom diff', async function() {
    let cpr = path.resolve(path.dirname(require.resolve('cpr')), '../bin/cpr');
    let remoteFixtures = 'test/fixtures/remote/noconflict';
    let startTag = 'v1';
    let endTag = 'v3';

    let {
      status
    } = await merge({
      localFixtures: 'test/fixtures/local/noconflict',
      remoteFixtures,
      remoteUrl: null,
      createCustomDiff: true,
      startCommand: `node ${cpr} ${path.resolve(remoteFixtures, startTag)} .`,
      endCommand: `node ${cpr} ${path.resolve(remoteFixtures, endTag)} .`,
      startTag,
      endTag
    });

    await fixtureCompare({
      mergeFixtures: 'test/fixtures/merge/noconflict'
    });

    expect(status).to.equal(`M  changed.txt
`);
  });

  it('preserves locally gitignored', async function() {
    await merge({
      localFixtures: 'test/fixtures/local/gitignored',
      remoteFixtures: 'test/fixtures/remote/gitignored',
      async beforeMerge() {
        await Promise.all([
          fs.ensureFile(path.join(localDir, 'local-and-remote')),
          fs.ensureFile(path.join(localDir, 'local-only')),
          fs.ensureFile(path.join(localDir, 'folder/local-and-remote')),
          fs.ensureFile(path.join(localDir, 'folder/local-only'))
        ]);
      }
    });

    await fixtureCompare({
      mergeFixtures: 'test/fixtures/merge/gitignored',
      async beforeCompare({
        localMergeDir
      }) {
        await Promise.all([
          fs.ensureFile(path.join(localMergeDir, 'local-and-remote')),
          fs.ensureFile(path.join(localMergeDir, 'local-only')),
          fs.ensureFile(path.join(localMergeDir, 'folder/local-and-remote')),
          fs.ensureFile(path.join(localMergeDir, 'folder/local-only'))
        ]);
      }
    });
  });

  describe('globally gitignored', function() {
    let realGlobalGitignorePath;

    before(async function() {
      try {
        realGlobalGitignorePath = (await utils.run('git config --global core.excludesfile')).trim();
      } catch (err) {}
      let tmpGlobalGitignorePath = path.join(await tmpDir(), '.gitignore');
      await fs.writeFile(tmpGlobalGitignorePath, '.vscode');
      await utils.run(`git config --global core.excludesfile "${tmpGlobalGitignorePath}"`);
    });

    after(async function() {
      if (realGlobalGitignorePath) {
        await utils.run(`git config --global core.excludesfile "${realGlobalGitignorePath}"`);
      }
    });

    it('works', async function() {
      await merge({
        localFixtures: 'test/fixtures/local/globally-gitignored',
        remoteFixtures: 'test/fixtures/remote/globally-gitignored'
      });

      await fixtureCompare({
        mergeFixtures: 'test/fixtures/merge/globally-gitignored'
      });
    });

    it('can create a custom diff', async function() {
      let cpr = path.resolve(path.dirname(require.resolve('cpr')), '../bin/cpr');
      let remoteFixtures = 'test/fixtures/remote/globally-gitignored';
      let startTag = 'v1';
      let endTag = 'v3';

      await merge({
        localFixtures: 'test/fixtures/local/globally-gitignored',
        remoteFixtures,
        remoteUrl: null,
        createCustomDiff: true,
        startCommand: `node ${cpr} ${path.resolve(remoteFixtures, startTag)} .`,
        endCommand: `node ${cpr} ${path.resolve(remoteFixtures, endTag)} .`,
        startTag,
        endTag
      });

      await fixtureCompare({
        mergeFixtures: 'test/fixtures/merge/globally-gitignored'
      });
    });
  });

  it('handles binary files', async function() {
    let {
      status
    } = await merge({
      localFixtures: 'test/fixtures/local/binary',
      remoteFixtures: 'test/fixtures/remote/binary'
    });

    await fixtureCompare({
      mergeFixtures: 'test/fixtures/merge/binary'
    });

    expect(status).to.equal(`M  changed.png
`);
  });

  it('handles spaces in path', async function() {
    let {
      status
    } = await merge({
      localFixtures: 'test/fixtures/local/space in dirname',
      remoteFixtures: 'test/fixtures/remote/space in dirname'
    });

    await fixtureCompare({
      mergeFixtures: 'test/fixtures/merge/space in dirname'
    });

    expect(status).to.equal(`M  "space in filename.txt"
`);
  });

  it('handles ignored broken symlinks', async function() {
    // another OSX /private workaround
    let realpath = {};

    async function createBrokenSymlink(srcpath, dstpath) {
      await fs.ensureFile(path.resolve(localDir, srcpath));
      await fs.symlink(srcpath, dstpath);
      realpath[srcpath] = await fs.realpath(path.resolve(localDir, srcpath));
      await fs.remove(path.resolve(localDir, srcpath));
    }

    async function assertBrokenSymlink(srcpath, dstpath) {
      expect(realpath[await fs.readlink(dstpath)]).to.equal(srcpath);
    }

    await merge({
      localFixtures: 'test/fixtures/local/gitignored',
      remoteFixtures: 'test/fixtures/remote/gitignored',
      async beforeMerge() {
        await createBrokenSymlink(
          path.normalize('./broken'),
          path.join(localDir, 'local-only')
        );
      }
    });

    await assertBrokenSymlink(
      path.join(localDir, 'broken'),
      path.join(localDir, 'local-only')
    );

    // `fixturify` doesn't support broken symlinks
    await fs.unlink(path.join(localDir, 'local-only'));

    await fixtureCompare({
      mergeFixtures: 'test/fixtures/merge/gitignored'
    });
  });

  it('handles ignored files that don\'t exist', async function() {
    let {
      status
    } = await merge({
      localFixtures: 'test/fixtures/local/noconflict',
      remoteFixtures: 'test/fixtures/remote/noconflict',
      ignoredFiles: ['missing.txt']
    });

    await fixtureCompare({
      mergeFixtures: 'test/fixtures/merge/noconflict'
    });

    expect(status).to.equal(`M  changed.txt
`);
  });

  it('handles ignored files that were added upstream', async function() {
    let {
      status
    } = await merge({
      localFixtures: 'test/fixtures/local/ignored-added',
      remoteFixtures: 'test/fixtures/remote/ignored-added',
      ignoredFiles: ['ignored-added.txt']
    });

    await fixtureCompare({
      mergeFixtures: 'test/fixtures/merge/ignored-added'
    });

    expect(status).to.equal(`M  changed.txt
`);
  });
});
