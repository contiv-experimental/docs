# volplugin

## Getting Started

### Clone and build the project

Please see the [prerequisites in the README](https://github.com/contiv/volplugin/blob/master/README.md#prerequisites)
before attempting these instructions.

### On Linux (without a VM):

Clone and build the project: 

* `git clone https://github.com/contiv/volplugin.git`
* `make run-build`
  * This will install some utilities for building the software in your
    `$GOPATH`, as well as the `volmaster`, `volplugin` and `volcli`
    utilities.

#### Everywhere else (with a VM):

* `git clone https://github.com/contiv/volplugin.git`
* `make start`

The build and each binary will be on the VM in `/opt/golang/bin`.

### Install Dependencies

* [etcd release notes and install instructions](https://github.com/coreos/etcd/releases/tag/v2.2.0)
  * We currently support versions 2.0 and up.
* [Ceph](http://docs.ceph.com/docs/master/start/)
  * If you have not installed Ceph before, a quick installation guide [is here](http://docs.ceph.com/docs/master/start/)
  * Ceph can be a complicated beast to install. If this is your first time
    using the project, please be aware there are pre-baked VMs that will work
    for you on any unix operating system. [See the README for more information](https://github.com/contiv/volplugin/blob/master/README.md#running-the-processes).

### Configure Services

The quickest way to do this with the VMs is from the Makefile: `make run`. You
may need to `make build` first.

Ensure ceph is fully operational, and that the `rbd` tool works as root.

1. Start etcd: `etcd &>/dev/null &`
1. Upload a tenant policy with `volcli tenant upload tenant1`. It accepts the
   policy from stdin.
    * You can find some examples of policy in
    [systemtests/testdata](https://github.com/contiv/volplugin/tree/master/systemtests/testdata).
    * If you just want a quick start without configuring it yourself: 
        * `cat systemtests/testdata/intent1.json | volcli tenant upload tenant1`
1. Start volmaster in debug mode (as root): `volmaster --debug &`
    * volmaster has a debug mode as well, but it's really noisy, so avoid using
    it with background processes. volplugin currently connects to volmaster
    using port 9005, but this will be variable in the future.
1. Start volsupervisor (as root): `volsupervisor &`
    * Note that debug mode for this tool is very noisy and is not recommended.
1. Start volplugin in debug mode (as root): `volplugin --debug &`
    * If you run volplugin on multiple hosts, you can use the `--master` flag to
    provide a ip:port pair to connect to over http. By default it connects to
    `127.0.0.1:9005`.

### Run Stuff!

Let's start a container with a volume.

1. Create a volume that refers to the volplugin driver:
   `docker volume create -d volplugin tenant1/test`
   * `test` is the name of your volume, and it lives under tenant `tenant1`,
     which you uploaded with `volcli tenant upload`
1. Run a container that uses it: `docker run -it -v tenant1/test:/mnt ubuntu bash`
1. Run `mount | grep /mnt` in the container, you should see the `/dev/rbd#`
   attached to that directory.
   * Once you have a multi-host setup, anytime the volume is not mounted, it
     can be mounted on any host that has a connected rbd client available, and
     volplugin running.

## Architecture

"volplugin", despite the name, is actually a suite of components:

`volmaster` is the master process. It exists to coordinate the volplugins in a
way that safely manages container volumes. It talks to `etcd` to keep its
state.

`volplugin` is the slave process. It exists to bridge the state management
between `volmaster` and `docker`, and to mount volumes on specific hosts.

`volcli` is a utility for managing `volmaster`'s data. It makes both REST calls
into the volmaster and additionally can write directly to etcd.

### Organizational Architecture

`volmaster` is completely stateless, and can be run multi-host for redundancy.
`volmaster` needs both root permissions, and capability to manipulate RBD
images with the `rbd` tool.

`volsupervisor` handles scheduled and supervised tasks such as snapshotting. It
may only be deployed on one host at a time.

`volplugin` needs to run on every host that will be running containers. Upon
start, it will create a unix socket in the appropriate plugin path so that
docker recognizes it. This creates a driver named `volplugin`.

`volcli` is a management tool and can live anywhere that has access to the etcd
cluster and volmaster.

### Security Architecture

There is none currently. This is still an alpha, security will be a beta
target.

### Network Architecture

`volmaster`, by default, listens on `0.0.0.0:9005`. It provides a REST
interface to each of its operations that are used both by `volplugin` and
`volcli`. It connects to etcd at `127.0.0.1:2379`, which you can change by
supplying `--etcd` one or more times.

`volsupervisor` needs root, connections to etcd, and access to ceph `rbd` tools
as admin.

`volplugin` contacts the volmaster but listens on no network ports (it uses a
unix socket as described above, to talk to docker). It by default connects to
the volmaster at `127.0.0.1:9005` and must be supplied the `--master` switch to
talk to a remote `volmaster`.

`volcli` talks to both `volmaster` and `etcd` to communicate various state and
operations to the system.

## Configuration

This section describes various ways to manipulate volplugin through
configuration and options.

### Volume Formatting

Because of limitations in the docker volume implementation, we use a *pattern*
to describe volumes to docker. This pattern is `tenant-name/volume-name`, and
is supplied to `docker volume create --name` and transfers to `docker run -v`.

For example, a typical use of volplugin might work like this presuming we have
a tenant uploaded named `tenant1`:

```
$ docker volume create -d volplugin --name tenant1/foo
$ docker run -it -v tenant1/foo:/mnt ubuntu bash
```

This pattern creates a volume called `foo` in `tenant1`'s default ceph pool. If
you wish to change the pool (or other options), see "Driver Options" below.

### JSON Tenant Configuration

Tenant configuration uses JSON to configure the default volume parameters such
as what pool to use. It is uploaded to etcd by the `volcli` tool.

Here is an example:

```javascript
{
  "default-options": {
    "size": "10MB",
    "snapshots": true,
    "snapshot": {
      "frequency": "30m",
      "keep": 20
    },
    "filesystem": "btrfs",
    "ephemeral": false,
    "rate-limit": {
      "write-iops": 1000,
      "read-iops": 1000,
      "write-bps": 100000000,
      "read-bps": 100000000
    }
  },
	"filesystems": {
		"btrfs": "mkfs.btrfs %",
		"ext4": "mkfs.ext4 -m0 %"
	}
}
```

Let's go through what these parameters mean.

* `default-options`: the options that will be persisted unless overridden (see
	"Driver Options" below)
  * `pool`: this option is **required**. It specifies the ceph pool volumes
    will be added to by default.
  * `size`: the size of the volume. Required is a unit of measurement like `GB`, `KB`, `MB` etc.
  * `snapshots`: use the snapshots facility.
  * `snapshot`: sub-level configuration for snapshots
    * `frequency`: the frequency between snapshots in Go's [duration notation](https://golang.org/pkg/time/#ParseDuration)
    * `keep`: how many snapshots to keep
	* `filesystem`: which filesystem to use. See below for how this works.
  * `ephemeral`: when `true`, deletes volumes upon `docker volume rm`.
  * `rate-limit`: sub-level configuration for rate limiting.
    * `write-iops`: Write IOPS
    * `read-iops`: Read IOPS
    * `read-bps`: Read b/s
    * `write-bps`: Write b/s
* `filesystems`: Provides a map of filesystem -> command for volumes to use in
	the `filesystem` option.
	* Commands are run when the filesystem is specified and the volume has not
		been created already.
	* Each command must contain a `%`, which will be replaced with the block
		device to be used. Supply `%%` to use a literal `%`.
	* Commands run in a POSIX (not bash, zsh) shell.
	* If the `filesystems` block is omitted, `mkfs.ext4 -m0 %` will be applied to
		all volumes within this tenant.

You supply them with `volcli tenant upload <tenant name>`. The JSON itself is
provided via standard input, so for example if your file is `tenant2.json`:

```
$ volcli tenant upload myTenant < tenant2.json
```

### Driver Options

Driver options are passed at `docker volume create` time with the `--opt` flag.
They are `key=value` pairs and are specified as such, f.e.:

```
docker volume create -d volplugin \
  --name tenant2/image \
  --opt size=1000
```

The options are as follows:

* `pool`: the pool to use for this volume.
* `size`: the size (in MB) for the volume.
* `snapshots`: take snapshots or not. Affects future options with `snapshot` in the key name.
  * the value must satisfy [this specification](https://golang.org/pkg/strconv/#ParseBool)
* `snapshots.frequency`: as above in the previous chapter, the frequency which we
  take snapshots.
* `snapshots.keep`: as above in the previous chapter, the number of snapshots to keep.
* `filesystem`: the named filesystem to create. See the JSON Configuration
  section for more information on this.
* `ephemeral`: delete this volume after `docker volume rm` occurs.
* `rate-limit.write.iops`: Write IOPS
* `rate-limit.read.iops`: Read IOPS
* `rate-limit.read.bps`: Read b/s
* `rate-limit.write.bps`: Write b/s

## volcli Reference

`volcli` controls the `volmaster`, which in turn is referenced by the
`volplugin` for local management of storage. Think of volcli as a tap into the
control plane.

### Top-Level Commands

These four commands present CRUD options on their respective sub-sections:

* `volcli tenant` manipulates tenant configuration
* `volcli volume` manipulates volumes. 
* `volcli mount` manipulates mounts.
* `volcli help` prints the help.
  * Note that for each subcommand, `volcli help [subcommand]` will print the
    help for that command. For multi-level commands, `volcli [subcommand] help
    [subcommand]` will work. Appending `--help` to any command will print the
    help as well.

### Tenant Commands

Typing `volcli tenant` without arguments will print help for these commands.

* `volcli tenant upload` takes a tenant name, and JSON configuration from standard input.
* `volcli tenant delete` removes a tenant. Its volumes and mounts will not be removed.
* `volcli tenant get` displays the JSON configuration for a tenant.
* `volcli tenant list` lists the tenants etcd knows about.

### Volume Commands

Typing `volcli volume` without arguments will print help for these commands.

* `volcli volume create` will forcefully create a volume just like it was created with
  `docker volume create`. Requires a tenant, and volume name.
* `volcli volume get` will retrieve the volume configuration for a given tenant/volume combination.
* `volcli volume list` will list all the volumes for a provided tenant.
* `volcli volume list-all` will list all volumes, across tenants.
* `volcli volume remove` will remove a volume given a tenant/volume
  combination, deleting the underlying data.  This operation may fail if the
  device is mounted, or expected to be mounted.
* `volcli volume force-remove`, given a tenant/volume combination, will remove
  the data from etcd but not perform any other operations. Use this option with
  caution.

### Mount Commands

Typing `volcli mount` without arguments will print help for these commands.

**Note:** `volcli mount` cannot control mounts -- this is managed by
`volplugin` which lives on each host. Eventually there will be support for
pushing operations down to the volplugin, but not yet.

* `volcli mount list` lists all known mounts in etcd.
* `volcli mount get` obtains specific information about a mount from etcd.
* `volcli mount force-remove` removes the contents from etcd, but does not
  attempt to perform any unmounting. This is useful for removing mounts that
  for some reason (e.g., host failure, which is not currently satsified by
  volplugin)
