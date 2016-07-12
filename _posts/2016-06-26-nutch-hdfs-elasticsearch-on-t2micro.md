---
layout: post
title: Nutch, HDFS, and Elasticsearch on AWS t2.micro instances (Free Tier)
image: 2016-06-26/system_diagram.png
---

As an exercise I committed to see how much I could accomplish of the following task definition: 

> Configure an HTTP crawler on Amazon AWS (Free Tier) with high performance and index a couple of websites.
>
> +  Use Nutch as crawler.
> +  Configure it to use several machines simultaneously for crawling.
> +  Configure HDFS as filesystem. 
> +  Use ElasticSearch for storage and indexing.

<!--more-->
And this is what I got after a week of work (15 hours):

<img style="display:block;margin:auto" src="{{ site.baseurl }}pics/2016-06-26/system_diagram.png" alt=""/>

+  Three Amazon EC2 t2.micro instances running Hadoop 2.6.4: one as master and two worker nodes.
+  Apache Nutch 1.12 successfully running on top of the Hadoop cluster.
+  An Elasticsearch cluster of two nodes successfully indexing the results of the Nutch crawl (5 shards and 1 replica).

Which we can compare to my initial estimation, assuming I would be able to work for a week, for a total of 10 hours:

+  `[COMPLETED]`. Nutch running on top of a 3-machine Hadoop cluster (85% chance of success).
+  `[COMPLETED]`. ElasticSearch integration (65% chance of success).
+  `[NOT COMPLETED]`. Small study regarding performance (40% chance of success).

This means that my final performance got pretty close to the expected results.

#1. Mini guide and references on how to set-up the system

###1.1. Hadoop

1) Spin up three t2.micro instances with the following Amazon Machine Image: Amazon Linux AMI 2016.03.2 (HVM), SSD Volume Type - ami-f303fb93. No need to change anything on the default configuration, but keep all three instances within the same Security Group [1].

2) In addition to the default SSH rule, add the following inbound rules to the Security Group (Type, Protocol, Port Range, Source):

+  All traffic, All, All, `$your_security_group`: this allows the three machines to communicate with each other
+  Custom TCP, TCP, 50700, `$ips_for_web_access`.
+  Same than above for ports 8088, 19888: these last two rules will allow you to access the web UI of ResourceManager and JobHistory Server to track the state of jobs and nodes (from the computers whose IPs are in `$ips_for_web_access).

3) Download Hadoop 2.6.4 binaries from [3]. Configure it according to this gist [4]. Helpful resources on this step are [5-7]. Only a few remarks are needed for configuration on different machines:

+  `core_site.xml/fs.defaultFS`. This address is your address of the node that will act as NameNode.
+  `slaves`. Change the address in there for the address of your worker nodes.
+  `yarn_site.xml/yarn.resourcemanager.hostname`. This is the address of the node that will act as ResourceManager.

4) Before start using the Distributed FileSystem (DFS), we have to format it by running the following command in the master node:

```
$HADOOP_HOME/bin/hdfs namenode -format $cluster_name
```
where `$cluster_name` is a name of your choice.

5) At this point, the hdfs (and YARN) should work. We can start all the required processes in all t2.micro instances by running on the master node:

```
$HADOOP_HOME/sbin/start-dfs.sh
$HADOOP_HOME/sbin/start-yarn.sh
$HADOOP_HOME/sbin/mr-jobhistory-daemon.sh start historyserver
```
6) We can test that all processes are up by taking the following actions:

+  Running on `jps` on the master node and slave nodes, which should display the name of the corresponding processes. You will need to instal java-devel first (`yum install java-devel).
+  We can put any file on the DFS from any node by running:

```
hdfs dfs -mkdir /test_dir
hdfs dfs -put $any_file_in_local_storage /test_dir/$file_name
```
And retrieving them in any other node by running `hdfs dfs -get /test_dir/$file_name $file_name`.

+ Finally, we are ready to run the popular WordCount MapReduce example. For example, save a text file "hello_world.txt" with the words "hello world hello Hello". Then, run these commands:

```
hdfs dfs -mkdir /hello_world_in
```
```
hdfs dfs -put hello_world.txt /helloWorld_input/hello_world.txt
```
```
hadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-2.6.4.jar wordcount /hello_world_in /hello_world_out
```
``
hdfs dfs -cat /hello_world_out/part*
```

You should see in stdout the corresponding word count:

```
Hello    1
hello    2
world    1
```

###1.2. Nutch
7) Download Apache Nutch 1.12 source from [14] to your "master" t2.micro instance. Good guides to follow are [15-16], although please note that step 12 is now different than in those resources [20].

8) Configure `$NUTCH_HOME/conf/nutch-site.xml` according to [4]. At this point, the only mandatory property is `http.agent.name`, which can be set to any arbitrary value.

9) For my example test case, in which I will only crawl this very same webpage, `$NUTCH_HOME/conf/regex-urlfilter.txt` also has to be edited with a regular expression matching all pages under `http://mario-lopeztelecom.github.io/`. Right below "Accept everything else", change the existing expression to:

```
+^http://mario-lopeztelecom.github.io/.*``
```

10) Copy the following files from the Hadoop configuration to `$NUTCH_HOME/conf`: `hadoop-env.sh, core-site.xml, hdfs-site.xml, mapred-site.xml, slaves`.

11) Install ant in order to compile Nutch (`yum install ant`), and run `ant runtime` on `$NUTCH_HOME`.

12) To test the crawl (without indexing), create a file `seeds.txt`, put in the DFS (_e.g.,_ in `/urls` folder), and then run:

```
$NUTCH_HOME/runtime/deploy/bin /urls /crawlOutput $rounds
```
where `$rounds is the number of rounds you want the crawler to run for.

###1.3. Elasticsearch

13) Download Elasticsearch 1.4.1 from [17], both on the "master" and "slave1" t2.micro instances.

14) On `$ELASTIC_HOME/config/elasticsearch.yml` @ slave1, made the following changes to be able to form a cluster:

+  Uncomment `#cluster.name: elasticsearch`: the slave1 instance of elasticsearch will join the existing cluster "elasticsearch" created by the master node.
+  `discovery.zen.ping.multicast.enabled: false`.
+  `discovery.zen.ping.unicast.hosts: [$address_of_master]`.

15) At this point you should be able to start both instances of elasticsearch (running `$ELASTIC_HOME/bin/elasticsearch` first on master, then on slave1) and see in the stdout that they form a cluster. With the standard config we have not touched, each instance should hold a replica of the data we store in elasticsearch. 

16) Create the (intially empty) index for the crawl results [18]. For example, we will create "test_index":

```
curl -XPUT 'localhost:9200/test_index?pretty'
```
17) If you have not done it already on step 8 (if you did not copied the whole contents of `nutch-site.xml` from [4], leaving out the ones related to elasticsearch), now it is the time to do so. These properties are pretty self-explanatory, only note that `elastic.host` refers to the address of the master instance of the elasticsearch cluster. Link [19] provides more info on these parameters. Also remember to recompile Nutch after doing these changes.

18) Finally, we can launch the whole crawl and indexing process with: 

```
$NUTCH_HOME/bin/crawl -i  /urls /crawlOutput  2
```
where the "-i" switch is for indexing on elasticsearch. If you have run the crawl first, and you only want to index the results of a particular segment, use the following command:

```
$NUTCH_HOME/runtime/deploy/bin/nutch index /crawlOutput//crawldb -linkdb /crawlOutput//linkdb /crawlOutput//segments/$segment
```

19) Test the result. We should be able to see the crawled contents on the elasticsearch index by running: 

```
curl 'localhost:9200/test_index/_search?q=*&pretty'
```
and you will see something similar to this:
<img style="display:block;margin:auto" src="{{ site.baseurl }}pics/2016-06-26/screen.png" alt=""/>


#2. Discussion on major difficulties and decisions made.

###2.1 Architecture
**2.1.1. Decision #1. How to split the required Hadoop roles.**

The decision of having a master coordinator-only node, instead of three worker nodes where one also holds the master role, came from the intuition that t2.micro instances, with 1GB of RAM, were going to struggle even under moderate workload. The memory issues I had later, as well as this StackOverflow post [8], confirmed this intuition.

**2.1.2. Decision #2. Elasticsearch cluster.**

Facing the previously mentioned memory issue, I was not sure on which node will be harmed the most by also running an Elasticsearch instance. Because of that, for experimentation purposes, I decided to spin up an Elasticsearch instance both on my "master" t2.micro instance and on one worker node, but not on the other (so that at least one node has a lower workload and a better chance to survive the workload.) Ideally, I would have put elasticsearch instances on separate t2.micro instance, but that would have got me out of the free tier.


###2.2. Configuration: memory issues
This has been, by far, the most difficult problem to solve. When running the whole crawl and indexing process, I could see lots of failed map tasks in the ApplicationTracker. In fact, many times, the job itself failed, DataNodes crashed, and/or elasticsearch was killed. 

**2.2.1. Identifying the issue**

Wordcount examples, as well as all the phases of Nutch crawl seem to run without errors (in this latter case, I could still see some failed map and reduce tasks). However, the indexing step of Nutch almost always failed. Fortunately, I could just run the indexing step on an existing segment from a previous crawl, with:

```
$NUTCH_HOME/runtime/deploy/bin/nutch index /crawlOutput//crawldb -linkdb /crawlOutput//linkdb /crawlOutput//segments/20160623170331
```
where `crawlOutput` is the folder in the DFS that held the segments of the Nutch crawl.

The stack traces I could see in the terminal where I launched the application, as well as in the ResourceManager web UI (or in the JobHistory Server) were not very informative most of the times:

```
Exit code: 1
Stack trace: ExitCodeException exitCode=1:
at org.apache.hadoop.util.Shell.runCommand(Shell.java:538)
at org.apache.hadoop.util.Shell.run(Shell.java:455)
at org.apache.hadoop.util.Shell$ShellCommandExecutor.execute(Shell.java:715)
at org.apache.hadoop.yarn.server.nodemanager.DefaultContainerExecutor.launchContainer(DefaultContainerExecutor.java:212)
at org.apache.hadoop.yarn.server.nodemanager.containermanager.launcher.ContainerLaunch.call(ContainerLaunch.java:302)
at org.apache.hadoop.yarn.server.nodemanager.containermanager.launcher.ContainerLaunch.call(ContainerLaunch.java:82)
at java.util.concurrent.FutureTask.run(FutureTask.java:262)
at java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1145)
at java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:615)
at java.lang.Thread.run(Thread.java:745)
```

But, at some point I realized that, randomly, one of these things happened:

+  The elasticsearch process was killed and I could see `org.elasticsearch.client.transport.NoNodeAvailableException: None of the configured nodes are available` on the stack traces. If I tried to start it again, I could even see on the terminal: `java.lang.OutOfMemoryError`.
+  `Error: unable to create new native thread Container killed by the ApplicationMaster. Container killed on request. Exit code is 143 Container exited with a non-zero exit code 143`.
+  "Slave1" t2.micro instance disappeared from the "Nodes" page on the ResourceManager web UI (and running `jps` on its terminal will show no sign of the NodeManager running).

Joining all this together made me quickly realize it was a memory issue.

**2.2.2. The issue**

The affected nodes run out of memory, and the OS killed one of the most consuming processes, which sometimes was the elasticsearch process, and sometimes a Hadoop process [9]. 

**2.2.3. The solution**

I reached the solution in two steps. First, this StackOverflow post allowed me to reach this page [10] about Hadoop memory configuration. Doing a quick check on the default values for properties such as `yarn.nodemanager.resource.memory-mb` [11] made me realize that they were unsuitable for a t2.micro instance (the default value of that property, which indicates the amount of physical memory that can be allocated for containers, was set to 8GB...). Thus, I changed my values according to [10]: I set a maximum limit of 768Mb for Hadoop processes, leaving some free memory for the OS.

This was not enough, however. Now the tasks were never allocated to any node and the jobs were never completed. It turns out there was also a need to restrict the amount of memory of the MR AppMaster containers [12], thus, accordingly, I set appropriate values for `yarn.app.mapreduce.am.resource.mb` and `yarn.app.mapreduce.am.command-opts` [13]. And this last fix allowed me to run all tasks without errors.

**2.2.4. Still to do**
I believe that there would be more properties to tweak in order to achieve a higher performance. For example, I set `yarn.scheduler.minimum-allocation-mb` to the same value of `yarn.nodemanager.resource.memory-mb`, which means that only one container is allowed on a worker node, reserving all the available memory (even if the task does not require such amount of memory.). This allows me to be on the safe side regarding memory limits, but for not memory demanding tasks, it results in under-utilization of resources.

#3. Minor discussions.
The following comments are related to the respective steps of the mini-guide on section 1.

1a- We can only spin up 3 t2.micro instances since the minimal amount of disk that can be set is 8GB, but more than 30GB falls out of the free tier [2]. I chose Amazon Linux AMI thinking that it may already contain certain prerequisites (Java SDK for example). In a production environment, different considerations may apply.

1b- I did not use any configuration management tool since this is a toy example and I could get by simply by broadcasting my input to terminals connected to all three nodes (using ITerm2), or doing scp of the config files. However, this would not be manageable for a higher number of instances (apart from having to manually reconfigure evertyhing each time a new instance boots up). In addition, Amazon AWS instances change their public IPs and DNS on boot: for this example I simply leave all them up, but again, that may not be cost-efective in a production environment and such environment will require automating the configuration.

2- In a production environment, security rules should be as restrictive as possible. Also, it is convenient to create specific users for Hadoop, Nutch... 

7- I chose Nutch 1.x over 2.x since I do not need the added features of 2.x and it seems to be harder to configure. We cannot use the binaries here, because we want it to run on top of our existing Hadoop cluster, and thus, the config files of our Hadoop installation will take part on the compilation process of Nutch. 

13- Unfortunately, Amazon Elasticsearch Service [15] cannot be used, and we must install and configure Elasticsearch by ourselves. The reason behind this is that such service only supports port 80 (the REST API to elasticsearch), whereas the elasticsearch plugin for Nutch uses the "Transport Client" which needs port 9300 (by default) [16].

14- For some unknown reason, the "automatic cluster discovery" of elasticsearch did not work for slave1 to automatically join master. Forcing unicast discovery did the trick.

#4. References
<div>
[1] <a href=http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EC2_GetStarted.html>http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EC2_GetStarted.html</a><br>
[2] <a href=https://aws.amazon.com/es/free>https://aws.amazon.com/es/free</a><br>
[3] <a href=http://www.apache.org/dyn/closer.cgi/hadoop/common/hadoop-2.6.4/hadoop-2.6.4.tar.gz>http://www.apache.org/dyn/closer.cgi/hadoop/common/hadoop-2.6.4/hadoop-2.6.4.tar.gz</a><br>
[4] <a href=https://gist.github.com/Mario-LopezTelecom/84a191bf76550ec1846d34b8e6d53595>https://gist.github.com/Mario-LopezTelecom/84a191bf76550ec1846d34b8e6d53595</a><br>
[5] <a href=http://hadoop.apache.org/docs/current/hadoop-project-dist/hadoop-common/ClusterSetup.html>http://hadoop.apache.org/docs/current/hadoop-project-dist/hadoop-common/ClusterSetup.html</a><br>
[6] <a href=http://www.allprogrammingtutorials.com/tutorials/setting-up-hadoop-2-6-0-cluster.php>http://www.allprogrammingtutorials.com/tutorials/setting-up-hadoop-2-6-0-cluster.php</a><br>  
[7] <a href=http://arturmkrtchyan.com/how-to-setup-multi-node-hadoop-2-yarn-cluster>http://arturmkrtchyan.com/how-to-setup-multi-node-hadoop-2-yarn-cluster</a><br>  
[8] <a href=http://stackoverflow.com/questions/29600370/hadoop-2-x-on-amazon-ec2-t2-micro>http://stackoverflow.com/questions/29600370/hadoop-2-x-on-amazon-ec2-t2-micro</a><br>  
[9] <a href=http://stackoverflow.com/questions/29001702/why-yarn-java-heap-space-memory-error>http://stackoverflow.com/questions/29001702/why-yarn-java-heap-space-memory-error</a><br>  
[10] <a href=http://hortonworks.com/blog/how-to-plan-and-configure-yarn-in-hdp-2-0/>http://hortonworks.com/blog/how-to-plan-and-configure-yarn-in-hdp-2-0</a><br>  
[11] <a href=http://hadoop.apache.org/docs/current/hadoop-yarn/hadoop-yarn-common/yarn-default.xml>http://hadoop.apache.org/docs/current/hadoop-yarn/hadoop-yarn-common/yarn-default.xml</a><br>  
[12] <a href=http://stackoverflow.com/questions/34467308/mapreduce-job-hangs-waiting-for-am-container-to-be-allocated>http://stackoverflow.com/questions/34467308/mapreduce-job-hangs-waiting-for-am-container-to-be-allocated</a><br>  
[13] <a href=https://gist.github.com/Mario-LopezTelecom/84a191bf76550ec1846d34b8e6d53595#file-mapred-site-xml-L41>https://gist.github.com/Mario-LopezTelecom/84a191bf76550ec1846d34b8e6d53595#file-mapred-site-xml-L41</a><br> 
[14] <a href=http://www.apache.org/dyn/closer.lua/nutch/1.12/apache-nutch-1.12-src.tar.gz>http://www.apache.org/dyn/closer.lua/nutch/1.12/apache-nutch-1.12-src.tar.gz</a><br>
[15] <a href=https://aws.amazon.com/es/elasticsearch-service/>https://aws.amazon.com/es/elasticsearch-service</a><br>
[16] <a href=https://forums.aws.amazon.com/thread.jspa?messageID=681938>https://forums.aws.amazon.com/thread.jspa?messageID=681938</a><br>
[17] <a href=https://download.elastic.co/elasticsearch/elasticsearch/elasticsearch-1.4.1.tar.gz>https://download.elastic.co/elasticsearch/elasticsearch/elasticsearch-1.4.1.tar.gz</a><br>
[18] <a href=https://www.elastic.co/guide/en/elasticsearch/reference/1.4/_create_an_index.html>https://www.elastic.co/guide/en/elasticsearch/reference/1.4/_create_an_index.html</a><br>
[19] <a href=https://www.mind-it.info/2013/09/26/integrating-nutch-1-7-elasticsearch/>https://www.mind-it.info/2013/09/26/integrating-nutch-1-7-elasticsearch</a><br>
[20] <a href=https://wiki.apache.org/nutch/NutchTutorial#Crawl_your_first_website/>https://wiki.apache.org/nutch/NutchTutorial#Crawl_your_first_website</a><br>
</div>




