# volplugin
Contiv Volume plugin [volplugin](https://github.com/contiv/volplugin "Title")
is a Ceph volume driver, and policy system that works well within a Docker
ecosystem. It can automatically move your storage with your containers, rather
than pinning containers to specific hosts to take advantage of their storage.

## Getting started

Getting started describes setting up a test environment with three VMs. Once
the test environment is setup see the [**Configure Services**](#Configure Services).

#### Prerequisites

Please read and follow the instructions in the prerequisites section of the
volplugin
[README](https://github.com/contiv/volplugin/blob/master/README.md#prerequisites)
before completing the following:

### Clone and build the project

### On Linux (without a VM)

Clone the project:

```
git clone https://github.com/contiv/volplugin
```

Build the project:

```
make run-build
```


The command `make run-build` installs utilities for building the software in
the `$GOPATH`, as well as the `volmaster`, `volplugin` and `volcli` utilities.

### Everywhere else (with a VM):

Clone the project:

```
git clone https://github.com/contiv/volplugin
```


Build the project:

```
make start
```


The build and binaries will be on the VM in the following directory `/opt/golang/bin`.

## Do it yourself

### Installing Dependencies

Use the Contiv [nightly releases](https://github.com/contiv/volplugin/releases)
when following these steps:

**Note:** Using the nightly builds is simpler than building the applications.

Install the dependencies in the following order:

1. Follow the [Getting Started](https://github.com/coreos/etcd/releases/tag/v2.2.0) to install [Etcd](https://coreos.com/etcd/docs/latest/getting-started-with-etcd.html).
  * Currently versions 2.0 and later are supported.

2. Follow the [Ceph Installation Guide](http://docs.ceph.com/docs/master/install/) to install [Ceph](http://ceph.com).
3. Configure Ceph with [Ansible](https://github.com/ceph/ceph-ansible).

  **Note**: See the [README](https://github.com/contiv/volplugin/blob/master/README.md#running-the-processes)
  for pre-configured VMs that work on any UNIX operating system to simplify
    Ceph installation.

4. Upload a global configuration. You can find an example one [here](https://github.com/contiv/volplugin/blob/master/systemtests/testdata/global1.json)

5. Start volmaster in debug mode (as root):

```
volmaster &
```

**Note**: volmaster debug mode is very noisy and is not recommended. Therefore,
avoid using it with background processes. volplugin currently connects to
volmaster using port 9005, however in the future it is variable.

6. Start volsupervisor (as root):

```
volsupervisor &
```


**Note**: volsupervisor debug mode is very noisy and is not recommended.

7.  Start volplugin in debug mode (as root):

```
volplugin &
```

If running volplugin on multiple hosts, use the `--master` flag to
provide a ip:port pair to connect to over http. By default it connects to
`127.0.0.1:9005`.

## Configure Services

Ensure Ceph is fully operational, and that the `rbd` tool works as root.

Upload a policy:

```
volcli policy upload policy1
```


**Note**: It accepts the policy from stdin, e.g.: `volcli policy upload policy1 < mypolicy.json`
Examples of a policy are in [systemtests/testdata](https://github.com/contiv/volplugin/tree/master/systemtests/testdata).

### Creating a container with a volume


Create a volume that refers to the volplugin driver:

```
docker volume create -d volplugin --name policy1/test
```

**Notes**:

* `test` is the name of the volume, and is located under policy `policy1`,
 which is uploaded with `volcli policy upload.`
* The volume will inherit the properties of the policy. Therefore, the
volume will be of appropriate size, iops, etc.
* There are numerous options (see below) to declare overrides of most parameters in the policy configuration.
* Run a container that uses the policy:

```
docker run -it -v policy1/test:/mnt ubuntu bash
```
* Run `mount | grep /mnt` in the container.


**Note**: `/dev/rbd#`should be attached to that directory.

* Once a multi-host system is setup, anytime the volume is not mounted, it
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
to describe volumes to docker. This pattern is `policy-name/volume-name`, and
is supplied to `docker volume create --name` and transfers to `docker run -v`.

For example, a typical use of volplugin might work like this presuming we have
a policy uploaded named `policy1`:

```
$ docker volume create -d volplugin --name policy1/foo
$ docker run -it -v policy1/foo:/mnt ubuntu bash
```

This pattern creates a volume called `foo` in `policy1`'s default ceph pool. If
you wish to change the pool (or other options), see "Driver Options" below.

### JSON Global Configuration

Global configuration modifies the whole system through the volmaster, volplugin
and volsupervisor systems. You can manipulate them with the `volcli global`
command set.

A global configuration looks like this:

```javascript
{
  "TTL": 60,
  "Debug": true,
  "Timeout": 5,
  "MountPath": "/mnt/ceph"
}
```

Options:

* TTL: time (in seconds) for a mount record to timeout in the event a volplugin dies
* Debug: boolean value indicating whether or not to enable debug traps/logging
* Timeout: time (in minutes) for a command to be terminated if it exceeds this value
* MountPath: the base path used for mount directories. Directories will be in
  `policy/volume` format off this root.

### JSON Tenant Configuration

Tenant configuration uses JSON to configure the default volume parameters such
as what pool to use. It is uploaded to etcd by the `volcli` tool.

Here is an example:

```javascript
{
  "backends": {
    "crud": "ceph",
    "mount": "ceph",
    "snapshot": "ceph"
  },
  "driver": {
    "pool": "rbd"
  },
  "create": {
    "size": "10MB",
    "filesystem": "btrfs"
  },
  "runtime": {
    "snapshots": true,
    "snapshot": {
      "frequency": "30m",
      "keep": 20
    },
    "rate-limit": {
      "write-iops": 1000,
      "read-iops": 1000,
      "write-bps": 100000000,
      "read-bps": 100000000
    }
  },
  "filesystems": {
    "ext4": "mkfs.ext4 -m0 %",
    "btrfs": "mkfs.btrfs %",
    "falsefs": "/bin/false"
  }
}
```

Let's go through what these parameters mean.

* `filesystems`: a policy-level map of filesystem name -> mkfs command.
  * Commands are run when the filesystem is specified and the volume has not
    been created already.
  * Commands run in a POSIX (not bash, zsh) shell.
  * If the `filesystems` block is omitted, `mkfs.ext4 -m0 %` will be applied to
    all volumes within this policy.
	* Referred to by the volume create-time parameter `filesystem`. Note that you
	  can use a `%` to be replaced with the device to format.
* `backends`: the storage backends to use for different operations. Note that
  not all drivers are compatible with each other. This is still an area with
  work being done on it. Currently only the "ceph" driver is supported.
  * `crud`: Create/Delete operations driver name
  * `mount`: Mount operations driver name
  * `snapshot`: Snapshot operations
* `driver`: driver-specific options.
	* `pool`: the ceph pool to use
* `create`: create-time options.
	* `size`: the size of the volume
  * `filesystem`: the filesystem to use, see `filesystems` above.
* `runtime`: runtime options. These options can be changed and the changes will
  be applied to mounted volumes almost immediately.
  * `snapshots`: use the snapshots feature
  * `snapshot`: map of the following parameters:
    * `frequency`: the amount of time between taking snapshots.
    * `keep`: the number of snapshots to keep. the oldest ones will be deleted first.
  * `rate-limit`: map of the following rate-limiting parameters:
    * `write-iops`: Write I/O weight 
    * `read-iops`: Read I/O weight
    * `write-bps`: Write bytes/s
    * `read-bps`: Read bytes/s

You supply them with `volcli policy upload <policy name>`. The JSON itself is
provided via standard input, so for example if your file is `policy2.json`:

```
$ volcli policy upload myTenant < policy2.json
```

### Driver Options

Driver options are passed at `docker volume create` time with the `--opt` flag.
They are `key=value` pairs and are specified as such, f.e.:

```
docker volume create -d volplugin \
  --name policy2/image \
  --opt size=1000
```

The options are as follows:

* `size`: the size (in MB) for the volume.
* `snapshots`: take snapshots or not. Affects future options with `snapshot` in the key name.
  * the value must satisfy [this specification](https://golang.org/pkg/strconv/#ParseBool)
* `snapshots.frequency`: as above in the previous chapter, the frequency which we
  take snapshots.
* `snapshots.keep`: as above in the previous chapter, the number of snapshots to keep.
* `filesystem`: the named filesystem to create. See the JSON Configuration
  section for more information on this.
* `rate-limit.write.iops`: Write IOPS
* `rate-limit.read.iops`: Read IOPS
* `rate-limit.read.bps`: Read b/s
* `rate-limit.write.bps`: Write b/s

## volcli Reference

`volcli` controls the `volmaster`, which in turn is referenced by the
`volplugin` for local management of storage. Think of volcli as a tap into the
control plane.

### Top-Level Commands

These commands present CRUD options on their respective sub-sections:

* `volcli global` manipulates global configuration.
* `volcli policy` manipulates policy configuration.
* `volcli volume` manipulates volumes.
* `volcli mount` manipulates mounts.
* `volcli help` prints the help.
  * Note that for each subcommand, `volcli help [subcommand]` will print the
    help for that command. For multi-level commands, `volcli [subcommand] help
    [subcommand]` will work. Appending `--help` to any command will print the
    help as well.

### Global Commands

* `volcli global upload` takes JSON global configuration from the standard input.
* `volcli global get` retrieves the JSON global configuration.

### Tenant Commands

Typing `volcli policy` without arguments will print help for these commands.

* `volcli policy upload` takes a policy name, and JSON configuration from standard input.
* `volcli policy delete` removes a policy. Its volumes and mounts will not be removed.
* `volcli policy get` displays the JSON configuration for a policy.
* `volcli policy list` lists the policies etcd knows about.

### Volume Commands

Typing `volcli volume` without arguments will print help for these commands.

* `volcli volume create` will forcefully create a volume just like it was created with
  `docker volume create`. Requires a policy, and volume name.
* `volcli volume get` will retrieve the volume configuration for a given policy/volume combination.
* `volcli volume list` will list all the volumes for a provided policy.
* `volcli volume list-all` will list all volumes, across policies.
* `volcli volume remove` will remove a volume given a policy/volume
  combination, deleting the underlying data.  This operation may fail if the
  device is mounted, or expected to be mounted.
* `volcli volume force-remove`, given a policy/volume combination, will remove
  the data from etcd but not perform any other operations. Use this option with
  caution.
* `volcli volume runtime get` will retrieve the runtime policy for a given volume
* `volcli volume runtime upload` will upload (via stdin) the runtime policy for a given volume

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

### Use Commands

Use commands control the locking system and also provide information about what
is being used by what. Use these commands with caution as they can affect the
stability of the cluster if used improperly.

* `volcli use list` will list all uses (mounts, snapshots) in effect.
* `volcli use get` will get information on a specific use lock.
* `volcli use force-remove` will force a lock open for a given volume.
* `volcli use exec` will wait for a lock to free, then execute hte command.
